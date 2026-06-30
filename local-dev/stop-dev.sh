#!/bin/bash
# ============================================================
# ITOps Agent Platform - 本地开发环境停止脚本 (Linux/Mac)
# ============================================================
# 使用说明:
#   ./stop-dev.sh           - 停止开发环境
#   ./stop-dev.sh --clean   - 停止并清理数据卷
# ============================================================

# 获取脚本所在目录
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

if [ "$1" = "--clean" ]; then
    echo ""
    echo "========================================="
    echo "  Stopping and Cleaning Development Environment"
    echo "========================================="
    echo ""
    echo "[WARN] This will remove all development data!"
    echo ""

    docker-compose down -v

    echo ""
    echo "[INFO] Development environment stopped and cleaned."
    echo ""
else
    echo ""
    echo "========================================="
    echo "  Stopping Development Environment"
    echo "========================================="
    echo ""

    docker-compose down

    echo ""
    echo "[INFO] Development environment stopped."
    echo ""
fi
