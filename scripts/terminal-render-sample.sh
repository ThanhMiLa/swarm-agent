#!/bin/sh
# Run the same fixture in iTerm2 and in a SwarmAgent shell.
printf '\033[0mRegular   Tiếng Việt — SwarmAgent 0123456789\033[0m\n'
printf '\033[1mBold      Tiếng Việt — SwarmAgent 0123456789\033[0m\n'
printf '\033[31mANSI red\033[0m     \033[34mANSI blue\033[0m     \033[36mANSI cyan\033[0m\n'
printf '\033[91mBright red\033[0m   \033[94mBright blue\033[0m   \033[96mBright cyan\033[0m\n'
printf '\033[38;2;255;112;47mRGB orange\033[0m   \033[38;2;88;164;255mRGB blue\033[0m      \033[38;2;47;207;200mRGB cyan\033[0m\n'
printf '\033[38;2;128;128;128mRGB gray\033[0m     \033[38;2;224;224;224mRGB white\033[0m     \033[1;38;2;224;224;224mRGB bold white\033[0m\n'
