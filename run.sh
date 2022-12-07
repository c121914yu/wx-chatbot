pm2 delete wechat-chatbot || true
pm2 start dist/main.js --name wechat-chatbot -e ./log/node_err.log -o ./log/node_out.log