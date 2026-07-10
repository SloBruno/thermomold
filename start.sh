#!/bin/bash
DIR="$(cd "$(dirname "$0")" && pwd)"

echo "======================================"
echo "  ThermoMold - Iniciando..."
echo "======================================"
echo ""

kill $(lsof -ti:3001 -ti:5173 2>/dev/null) 2>/dev/null
sleep 1

echo " [1/2] Iniciando servidor..."
setsid bash -c "cd $DIR/server && exec npm run dev" > /tmp/thermomold-server.log 2>&1 &
sleep 2

echo " [2/2] Iniciando client..."
setsid bash -c "cd $DIR/client && exec npm run dev -- --host 0.0.0.0" > /tmp/thermomold-client.log 2>&1 &
sleep 3

echo ""
echo "======================================"
echo "  URLs:"
echo "    Simulador: http://localhost:5173/simple-simulator"
echo "    Dashboard: http://localhost:5173/simple-dashboard"
echo "    API:       http://localhost:3001/health"
echo ""
echo "  IPs da rede:"
grep -o "http://[0-9.]*:5173" /tmp/thermomold-client.log 2>/dev/null
echo "======================================"
