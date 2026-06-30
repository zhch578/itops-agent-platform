#!/bin/bash
# ============================================================
# ITOps Agent Platform - 本地开发环境启动脚本 (Linux/Mac)
# ============================================================
# 使用说明:
#   ./start-dev.sh          - 启动开发环境
#   ./start-dev.sh --build  - 强制重新构建镜像
#   ./start-dev.sh --help   - 显示帮助信息
# ============================================================

set -e

# 获取脚本所在目录
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

# 帮助信息
show_help() {
    echo ""
    echo "ITOps Agent Platform - Local Development Environment"
    echo ""
    echo "Usage: ./start-dev.sh [OPTIONS]"
    echo ""
    echo "Options:"
    echo "  --build    Force rebuild of Docker images"
    echo "  --help, -h Show this help message"
    echo ""
    echo "Without options, starts the environment using existing images if available."
    echo ""
    exit 0
}

# 检查参数
if [ "$1" = "--help" ] || [ "$1" = "-h" ]; then
    show_help
fi

echo ""
echo "========================================="
echo "  ITOps Agent Platform - 本地开发环境"
echo "========================================="
echo ""

# 检查 .env 文件是否存在
if [ ! -f ".env" ]; then
    echo "[INFO] .env file not found, creating from .env.example..."
    cp .env.example .env
    echo "[INFO] Created .env file"
    echo "[WARN] Please check and modify .env if needed"
    echo ""
fi

# 检查 Docker 是否运行
if ! docker info > /dev/null 2>&1; then
    echo "[ERROR] Docker is not running. Please start Docker Desktop and try again."
    exit 1
fi

echo "[INFO] Starting development environment..."
echo ""

if [ "$1" = "--build" ]; then
    echo "[INFO] Building images..."
    docker-compose build --no-cache
else
    echo "[INFO] Building images if needed..."
    docker-compose build
fi

echo ""
echo "[INFO] Starting services..."
docker-compose up -d

echo ""
echo "========================================="
echo "  Development environment is starting..."
echo "========================================="
echo ""
echo "  Backend:  http://localhost:3001"
echo "  Frontend: http://localhost:5173"
echo "  Debug:    http://localhost:9229 (Node.js debugger)"
echo ""
echo "  Useful commands:"
echo "    docker-compose logs -f          - View logs"
echo "    docker-compose logs -f backend  - View backend logs only"
echo "    docker-compose logs -f frontend - View frontend logs only"
echo "    docker-compose down             - Stop environment"
echo "    docker-compose restart          - Restart services"
echo ""
echo "  To stop: run ./stop-dev.sh"
echo "========================================="
echo ""

# 显示服务状态
docker-compose ps
