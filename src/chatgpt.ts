import { ChatGPTAPI, ChatGPTConversation } from "chatgpt";
import { Message } from "wechaty";
import { ContactInterface,RoomInterface } from "wechaty/impls";
import { config } from "./config.js";
import { execa } from "execa";
import { Cache } from "./cache.js";

interface MessageQueueType {
  message:Message,
  remainAmount: number
}

export class ChatGPTBot {
  // Record talkid with conversation id
  conversations = new Map<string, ChatGPTConversation>();
  chatGPTPools: Array<ChatGPTAPI> | [] = [];
  cache = new Cache("cache.json");
  botName: string = "";
  setBotName(botName: string) {
    this.botName = botName;
  }
  messageQueue: MessageQueueType[] = []
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
   * 获取发送实例
   */
  useSendItem(message: Message) {
    const talker = message.talker(); // 发送消息的人
    const room = message.room(); // 群聊
    const text = message.text(); // 发送的文本

    const realText = this.cleanMessage(text).replace(`archer`, "").trim(); // chatbot替换掉

    let responseItem:RoomInterface | ContactInterface = talker
    if(talker.self()) { // 自己，不能和自己say，需要获取到对方的消息
      responseItem = message.to() as ContactInterface
    }
    if(room) { // 群发消息
      responseItem = room
    }
    return {
      talker,
      room,
      text: realText,
      say: (text: string, cut: boolean) => {
        const sendText = cut ?  `${realText.slice(0,12)}\n- - - - -\n${text}` : `${realText}\n ------\n${text}`
        responseItem.say(sendText, talker)
      }
    }
  }
  /**
   * 预发送。把需要发送的消息放到队列里
   */
  preSendMessage(message: Message) {
    this.messageQueue.push({
      message,
      remainAmount: 2 // 最多发2次
    })

    const { say } = this.useSendItem(message)

    if(this.messageQueue.length === 1) { // 只有一个消息。代表着前面没有任何内容
      say(`给我点时间，我需要思考一下这个问题...`, true)
      this.sendMessageFn()
    } else { // 发送排队提示语
      say(`我在想其他人的问题，前面有: ${this.messageQueue.length-1}人`, true)
    }
  }
  /**
   * 发送消息方法，用于递归
   */
  async sendMessageFn() {
    const item = this.messageQueue[0]
    if(!item) return
    const { say } = this.useSendItem(item.message)

    item.remainAmount-- // 发送次数减少一次

    try {
      await this.sendMessage(item.message)
      this.messageQueue.shift()
    } catch(err) {
      console.log('error: ', err);
      
      if(item.remainAmount <= 0) { // 没有发送机会了，则报错
        this.messageQueue.shift()
        say(`出现了点意外，我挂了`, true)
      } else { // 还有重发机会
        console.log("消息超时，重发");
        say(`emm, 网络有点差，我再试一试...`, true)
        // 这里不需要递归，因为下面的函数肯定会执行
      }
    }

    // 判断是否队列里，是否还有内容需要执行
    if(this.messageQueue.length > 0) {
      if(this.messageQueue[0].remainAmount === 2) { // 标明是下个任务
        say(`我在想这个问题`, true)
      }
      this.sendMessageFn()
    }
  }
  /**
   * 发送消息。 先请求chatGPT内容，然后发送到客户端
   */
  async sendMessage(message: Message) {
    const {text, talker, room, say} = this.useSendItem(message)

    try {
      if (!room) { // 私人聊天
        console.log(`发消息ing,给: ${talker.name()}`);
        const response = await this.getGPTMessage(text, talker.id);
        say(response, false)
        console.log(`消息已发送给: ${talker.name()}`);
        return;
      }
      
      // 群聊
      const topic = await room.topic();

      console.log(`发消息ing给: ${topic}`);
      const response = await this.getGPTMessage(text, talker.id);
      say(response, false)
      console.log(`消息已发送给: ${topic}`);
    } catch (error) {
      return Promise.reject(error)
    }
  }
}
