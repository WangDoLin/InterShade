#!/usr/bin/env bash
# InterShader POSIX Shell Installation Script (Hermes Agent Style)
# Requirements: Linux/macOS, Node.js >= 20.0.0, Git

set -e

GOLD='\033[38;5;220m'
CYAN='\033[96m'
GREEN='\033[32m'
YELLOW='\033[33m'
RESET='\033[0m'

printf "${GOLD}"
cat << 'EOF'
+---------------------------------------------------------------+
|  ##### #   # ##### ##### ####   #### #   #  ###  ####  #####  |
|    #   ##  #   #   #     #   # #     #   # #   # #   # #      |
|    #   # # #   #   ####  ####   ###  ##### ##### #   # ####   |
|    #   #  ##   #   #     # #       # #   # #   # #   # #      |
|  ##### #   #   #   ##### #  ## ####  #   # #   # ####  #####  |
|                                                               |
|                          Wang Do Lin                          |
|                         Agentic Coding                        |
+---------------------------------------------------------------+
EOF
printf "${RESET}\n"

echo -e "${CYAN}>>> Starting InterShader Installation on Linux/macOS...${RESET}"

# 1. Check Node.js
if ! command -v node >/dev/null 2>&1; then
    echo "Error: Node.js is not installed. Please install Node.js >= v20.0.0 from https://nodejs.org" >&2
    exit 1
fi

NODE_VER=$(node -v | sed 's/^v//' | cut -d. -f1)
if [ "$NODE_VER" -lt 20 ]; then
    echo "Error: Requires Node.js >= v20.0.0. Current version: $(node -v)" >&2
    exit 1
fi
echo -e "${GREEN}[OK] Node.js satisfied: $(node -v)${RESET}"

# 2. Check Git
if command -v git >/dev/null 2>&1; then
    echo -e "${GREEN}[OK] Git satisfied: $(git --version)${RESET}"
else
    echo -e "${YELLOW}[WARN] Git not found. Worktree Isolation features may be limited.${RESET}"
fi

# 3. Project Root
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
cd "$PROJECT_ROOT"

# 4. Install dependencies & build production bundle
echo -e "\n${CYAN}>>> Checking dependencies...${RESET}"
if [ ! -d "node_modules" ]; then
    echo "Running npm install..."
    npm install
else
    echo -e "${GREEN}[OK] node_modules directory exists.${RESET}"
fi

echo -e "\n${CYAN}>>> Compiling production bundle (tsup)...${RESET}"
npm run build

# 5. Register global commands (npm link)
echo -e "\n${CYAN}>>> Registering global CLI commands (npm link)...${RESET}"
if npm link 2>/dev/null; then
    echo -e "${GREEN}[OK] Successfully registered global commands: 'intershader' and 'intershade'!${RESET}"
else
    echo -e "${YELLOW}[WARN] npm link requires sudo permissions. Try: sudo npm link, or run directly: node dist/index.js${RESET}"
fi

# 6. Launch Onboarding Setup Wizard
echo -e "\n${CYAN}>>> Launching Onboarding Setup Wizard...${RESET}"
node dist/index.js setup

echo -e "\n${GREEN}>>> INSTALLATION COMPLETE!${RESET}"
echo -e "You can now run InterShader from any terminal:"
echo -e "   ${YELLOW}intershader${RESET}"
echo -e "   ${YELLOW}intershade${RESET}"
echo -e "   ${YELLOW}intershader /doctor${RESET}\n"
