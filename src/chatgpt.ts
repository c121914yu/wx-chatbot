import { ChatGPTAPI, ChatGPTConversation } from "chatgpt";
import { Message } from "wechaty";
import { ContactInterface,RoomInterface } from "wechaty/impls";
import { config } from "./config.js";
import { execa } from "execa";
import { Cache } from "./cache.js";

export class ChatGPTBot {
  // Record talkid with conversation id
  conversations = new Map<string, ChatGPTConversation>();
  chatGPTPools: Array<ChatGPTAPI> | [] = [];
  cache = new Cache("cache.json");
  botName: string = "";
  setBotName(botName: string) {
    this.botName = botName;
  }
  /**
   * 登录，获取session token
   */
  async getSessionToken(email: string, password: string): Promise<string> {
    if (this.cache.get(email)) {
      return this.cache.get(email);
    }
    const cmd = `poetry run python3 src/generate_session.py ${email} ${password}`;
    const { stdout, stderr, exitCode } = await execa(`sh`, ["-c", cmd]);
    if (exitCode !== 0) {
      console.error("获取token错误===",stderr);
      return "";
    }
    // The last line in stdout is the session token
    const lines = stdout.split("\n");
    if (lines.length > 0) {
      this.cache.set(email, lines[lines.length - 1]);
      return lines[lines.length - 1];
    }
    return "";
  }

  /**
   * 开始chat GPT机器人
   */
  async startGPTBot() {
    try {
      console.log('connecting chatGPT....');
      const chatGPTPools = (
        await Promise.all(
          config.chatGPTAccountPool.map(
            async (account: {
              email?: string;
              password?: string;
              session_token?: string;
            }): Promise<string> => {
              if (account.session_token) {
                return account.session_token;
              } else if (account.email && account.password) {
                return await this.getSessionToken(
                  account.email,
                  account.password
                );
              } else {
                return "";
              }
            }
          )
        )
      )
        .filter((token: string) => token)
        .map((token: string) => {
          return new ChatGPTAPI({
            sessionToken: token,
            accessTokenTTL: 60000000
          });
        });
      console.log(`Chatgpt pool size: ${chatGPTPools.length}`);
      this.chatGPTPools = chatGPTPools;
    } catch (error) {
      console.log('连接chatGPT失败', error);
    }
  }
  
  /**
   * 获取chatAPI 实例
   */
  get chatgpt(): ChatGPTAPI {
    if (this.chatGPTPools.length === 0) {
      throw new Error("No chatgpt session token");
    } else if (this.chatGPTPools.length === 1) {
      return this.chatGPTPools[0];
    }
    const index = Math.floor(Math.random() * this.chatGPTPools.length);
    return this.chatGPTPools[index];
  }
  resetConversation(talkerId: string): void {
    const chatgpt = this.chatgpt;
    this.conversations.set(talkerId, chatgpt.getConversation());
  }
  /**
   * 获取我们的对话，如果未创建，则创建一个容器记录信息
   */
  getConversation(talkerId: string): ChatGPTConversation {
    const chatgpt = this.chatgpt;
    if (this.conversations.get(talkerId) !== undefined) {
      return this.conversations.get(talkerId) as ChatGPTConversation;
    }
    const conversation = chatgpt.getConversation();
    this.conversations.set(talkerId, conversation);
    return conversation;
  }
  // TODO: Add reset conversation id and ping pong
  async command(): Promise<void> {}

  /**
   * 清理message，删除一些回复内容
   */
  cleanMessage(text: string): string {
    let realText = text;
    const item = text.split("- - - - - - - - - - - - - - -");
    if (item.length > 1) {
      realText = item[item.length - 1];
    }
    // remove more text via - - - - - - - - - - - - - - -
    return realText;
  }

  /**
   * 发送message到chatGPT，等到消息返回
   */
  getGPTMessage(text: string, talkerId: string): Promise<string> {
    const conversation = this.getConversation(talkerId);
    if(!this.chatgpt.getIsAuthenticated()) return Promise.reject("我挂了")
    return conversation.sendMessage(text)
  }
  /**
   * 监听到客户端消息
   */
  async onMessage(message: Message) {
    const talker = message.talker(); // 发送消息的人
    const text = message.text(); // 发送的文本
    const room = message.room(); // 群聊
    
    let responseObj:RoomInterface | ContactInterface = talker
    if(talker.self()) { // 自己，不能和自己say，需要获取到对方的消息
      responseObj = message.to() as ContactInterface
    }
    if(room) { // 群发消息
      responseObj = room
    }

    try {
      const realText = this.cleanMessage(text).replace(`chatbot`, "").trim();
      
      if (!room) { // 私人聊天
        console.log(`发消息ing,给: ${talker.name()}`);
        responseObj.say(`thinking: ${realText.slice(0,6)}...`)
        const response = await this.getGPTMessage(realText, talker.id);
        responseObj.say(response)
        console.log(`消息已发送给: ${talker.name()}`);
        return;
      }
      
      const topic = await room.topic();

      console.log(`发消息ing给: ${topic}`);
      responseObj.say(`thinking: ${realText.slice(0,6)}...`)
      const response = await this.getGPTMessage(realText, talker.id);
      const result = `${realText}\n ------\n ${response}`;
      await responseObj.say(result, talker);
      console.log(`消息已发送给: ${topic}`);
    } catch (error) {
      responseObj.say("别问了，我挂了")
      return Promise.reject(error)
    }
  }
}
