#  wechat-chatgpt

node > 16  

基于https://github.com/fuergaosi233/wechat-chatgpt 这个项目二次开发。  
优化了交互，只有输入关键词才会触发，并且会先给提问者一个反馈。因为chatGPT只能单个请求，所以增加了队列，同一个聊天框会生成一个对话实例，对话实例同时只能发出一个请求，后续的请求会进入队列等待。  

## 安装

```sh
npm install
```

## **配置token**
1. 你需要准备好自己的openAI账号。
2. 前往chatGPT bot网页版：https://chat.openai.com/chat。 
3. 打开开发者调试工具。
4. 打开 Application > Cookies.  
![image](docs/images/session-token.png)  
5. 复制__Secure-next-auth.session-token
6. 在 config.ts 文件中加入token。这是一个数组，你可以加多个token，对话生成时会随机选取。  

## 启动项目
本地运行：
```sh
npm run dev
```

如果是部署服务器：  
``sh
sh run.sh
``

运行时，你需要微信扫码登录。这是安全的，详细请参考wechaty库。登录后，服务器会代理你的web端微信，此时你无法使用电脑wx。

Thanks
