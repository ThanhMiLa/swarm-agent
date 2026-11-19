use rmcp::{
    model::{
        CallToolRequestParams, CallToolResult, ListToolsResult, PaginatedRequestParams, ServerInfo,
    },
    service::{Peer, RequestContext, RoleClient, RoleServer},
    transport::{
        stdio, streamable_http_client::StreamableHttpClientTransportConfig,
        StreamableHttpClientTransport,
    },
    ErrorData, ServerHandler, ServiceExt,
};

use tokio::io::{AsyncBufReadExt, AsyncRead, AsyncReadExt, AsyncWrite, AsyncWriteExt, BufReader};

/// Antigravity may probe for an optional discovery extension before the
/// standard MCP handshake. Decline the extension and preserve the following
/// initialize request for rmcp, which only accepts initialize or ping first.
async fn prepare_stdio<R, W>(
    input: R,
    mut output: W,
) -> std::io::Result<(impl AsyncRead + Unpin, W)>
where
    R: AsyncRead + Unpin,
    W: AsyncWrite + Unpin,
{
    const MAX_HANDSHAKE_BYTES: u64 = 64 * 1024;
    let mut input = BufReader::new(input);
    loop {
        let mut line = String::new();
        let count = (&mut input)
            .take(MAX_HANDSHAKE_BYTES)
            .read_line(&mut line)
            .await?;
        if count as u64 == MAX_HANDSHAKE_BYTES && !line.ends_with('\n') {
            return Err(std::io::Error::new(
                std::io::ErrorKind::InvalidData,
                "MCP handshake is too large",
            ));
        }
        if let Ok(message) = serde_json::from_str::<serde_json::Value>(&line) {
            if message.get("method").and_then(serde_json::Value::as_str) == Some("server/discover")
            {
                if let Some(id) = message.get("id") {
                    let reply = serde_json::json!({
                        "jsonrpc": "2.0", "id": id,
                        "error": { "code": -32601, "message": "Method not found" }
                    });
                    output.write_all(reply.to_string().as_bytes()).await?;
                    output.write_all(b"\n").await?;
                    output.flush().await?;
                }
                continue;
            }
        }
        return Ok((std::io::Cursor::new(line.into_bytes()).chain(input), output));
    }
}

struct Bridge {
    client: Peer<RoleClient>,
    info: ServerInfo,
}

impl ServerHandler for Bridge {
    fn get_info(&self) -> ServerInfo {
        self.info.clone()
    }

    async fn list_tools(
        &self,
        request: Option<PaginatedRequestParams>,
        _: RequestContext<RoleServer>,
    ) -> Result<ListToolsResult, ErrorData> {
        self.client
            .list_tools(request)
            .await
            .map_err(|e| ErrorData::internal_error(e.to_string(), None))
    }

    async fn call_tool(
        &self,
        request: CallToolRequestParams,
        _: RequestContext<RoleServer>,
    ) -> Result<CallToolResult, ErrorData> {
        self.client
            .call_tool(request)
            .await
            .map_err(|e| ErrorData::internal_error(e.to_string(), None))
    }
}

// Antigravity loads its global MCP entries even outside SwarmAgent.
struct Inactive;
impl ServerHandler for Inactive {}

async fn run() -> Result<(), Box<dyn std::error::Error>> {
    let (input, output) = stdio();
    let transport = prepare_stdio(input, output).await?;
    let (Ok(url), Ok(token)) = (
        std::env::var("SWARM_AGENT_MCP_URL"),
        std::env::var("SWARM_AGENT_SESSION"),
    ) else {
        Inactive.serve(transport).await?.waiting().await?;
        return Ok(());
    };
    let endpoint = url::Url::parse(&url)?;
    if endpoint.scheme() != "http"
        || endpoint.host_str() != Some("127.0.0.1")
        || endpoint.path() != "/mcp"
    {
        return Err("SwarmAgent MCP bridge requires the app's loopback endpoint".into());
    }
    let mut config = StreamableHttpClientTransportConfig::with_uri(url);
    config.auth_header = Some(token);
    let http = reqwest::Client::builder()
        .no_proxy()
        .redirect(reqwest::redirect::Policy::none())
        .build()?;
    let client = ().serve(StreamableHttpClientTransport::with_client(http, config)).await?;
    let info = client
        .peer_info()
        .ok_or("Missing MCP server information")?
        .as_ref()
        .clone();
    Bridge {
        client: client.peer().clone(),
        info,
    }
    .serve(transport)
    .await?
    .waiting()
    .await?;
    client.cancel().await?;
    Ok(())
}

pub fn run_cli() {
    let result = tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()
        .map_err(|e| e.to_string())
        .and_then(|runtime| runtime.block_on(run()).map_err(|e| e.to_string()));
    if let Err(error) = result {
        eprintln!("SwarmAgent MCP: {error}");
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use rmcp::{
        model::{ServerCapabilities, Tool},
        transport::streamable_http_server::{
            session::local::LocalSessionManager, tower::StreamableHttpService,
            StreamableHttpServerConfig,
        },
    };
    use std::sync::Arc;

    #[tokio::test]
    async fn stdio_declines_optional_discovery_and_replays_initialize() {
        let (client, server) = tokio::io::duplex(1024);
        let (read, mut write) = tokio::io::split(client);
        write
            .write_all(
                b"{\"jsonrpc\":\"2.0\",\"id\":\"agy-probe\",\"method\":\"server/discover\"}\n",
            )
            .await
            .unwrap();
        let init = b"{\"jsonrpc\":\"2.0\",\"id\":2,\"method\":\"initialize\"}\n";
        write.write_all(init).await.unwrap();
        let (input, output) = tokio::io::split(server);
        let (mut input, _) = prepare_stdio(input, output).await.unwrap();

        let mut response = String::new();
        BufReader::new(read).read_line(&mut response).await.unwrap();
        let reply: serde_json::Value = serde_json::from_str(&response).unwrap();
        assert_eq!(reply["id"], "agy-probe");
        assert_eq!(reply["error"]["code"], -32601);
        let mut replay = vec![0; init.len()];
        input.read_exact(&mut replay).await.unwrap();
        assert_eq!(replay, init);
    }

    struct Stub;

    impl ServerHandler for Stub {
        fn get_info(&self) -> ServerInfo {
            ServerInfo::new(ServerCapabilities::builder().enable_tools().build())
                .with_instructions("Finish your turn after dispatch")
        }

        async fn list_tools(
            &self,
            _: Option<PaginatedRequestParams>,
            _: RequestContext<RoleServer>,
        ) -> Result<ListToolsResult, ErrorData> {
            Ok(ListToolsResult::with_all_items(vec![Tool::new(
                "team_dispatch",
                "Dispatch once",
                Arc::new(serde_json::Map::new()),
            )]))
        }

        async fn call_tool(
            &self,
            request: CallToolRequestParams,
            _: RequestContext<RoleServer>,
        ) -> Result<CallToolResult, ErrorData> {
            assert_eq!(request.name, "team_dispatch");
            Ok(CallToolResult::success(vec![
                rmcp::model::ContentBlock::text("ack"),
            ]))
        }
    }

    #[tokio::test]
    async fn bridge_forwards_instructions_tools_and_calls_with_session_bearer() {
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let url = format!("http://{}/mcp", listener.local_addr().unwrap());
        let server = StreamableHttpService::new(
            || Ok(Stub),
            Arc::new(LocalSessionManager::default()),
            StreamableHttpServerConfig::default(),
        );
        let router =
            axum::Router::new()
                .route_service("/mcp", server)
                .layer(axum::middleware::from_fn(
                    |request: axum::extract::Request, next: axum::middleware::Next| async move {
                        assert_eq!(request.headers()["authorization"], "Bearer fixture-session");
                        next.run(request).await
                    },
                ));
        let http = tokio::spawn(async move { axum::serve(listener, router).await.unwrap() });

        let mut config = StreamableHttpClientTransportConfig::with_uri(url);
        config.auth_header = Some("fixture-session".into());
        let upstream = ().serve(StreamableHttpClientTransport::from_config(config)).await.unwrap();
        let info = upstream.peer_info().unwrap().as_ref().clone();
        let bridge = Bridge {
            client: upstream.peer().clone(),
            info,
        };
        let (server_io, client_io) = tokio::io::duplex(16_000);
        let serving = tokio::spawn(async move {
            let (input, output) = tokio::io::split(server_io);
            bridge
                .serve(prepare_stdio(input, output).await.unwrap())
                .await
                .unwrap()
                .waiting()
                .await
                .unwrap()
        });
        let local = ().serve(tokio::io::split(client_io)).await.unwrap();
        assert_eq!(
            local.peer_info().unwrap().instructions.as_deref(),
            Some("Finish your turn after dispatch")
        );
        let listed = local.list_tools(None).await.unwrap();
        assert_eq!(listed.tools[0].name, "team_dispatch");
        let result = local
            .call_tool(CallToolRequestParams::new("team_dispatch"))
            .await
            .unwrap();
        assert!(!result.is_error.unwrap_or(false));
        assert!(result.content[0]
            .as_text()
            .is_some_and(|text| text.text == "ack"));
        local.cancel().await.unwrap();
        serving.abort();
        upstream.cancel().await.unwrap();
        http.abort();
    }
}
