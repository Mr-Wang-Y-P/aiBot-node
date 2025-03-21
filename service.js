import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { createServer } from 'http';
import multer from 'multer';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';

// 配置环境变量
dotenv.config();

const app = express();
const server = createServer(app);
const PORT = process.env.PORT || 3000;

// 中间件
app.use(cors());
app.use(express.json());

// 配置文件上传
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const uploadDir = path.join(__dirname, 'uploads');

// 确保上传目录存在
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, uploadDir);
  },
  filename: function (req, file, cb) {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, file.fieldname + '-' + uniqueSuffix + path.extname(file.originalname));
  }
});

const upload = multer({ storage: storage });

// AI 模型配置
const AI_MODELS = {
  'openrouter-deepseek': {
    name: 'DeepSeek ChatV3',
    apiKey: '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',
    endpoint: 'https://openrouter.ai/api/v1/chat/completions',
    model: 'deepseek/deepseek-chat:free',
    type: 'openrouter',
  },
  'openrouter-google/gemini-2.0-flash': {
    name: 'Google/gemini-2.0-flash',
    apiKey: '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',
    endpoint: 'https://openrouter.ai/api/v1/chat/completions',
    model: 'google/gemini-2.0-flash-thinking-exp:free',
    type: 'openrouter',
  },
  'openrouter-deepseek70B': {
    name: 'DeepSeek70B',
    apiKey: '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',
    endpoint: 'https://openrouter.ai/api/v1/chat/completions',
    model: 'deepseek/deepseek-r1-distill-llama-70b:free',
    type: 'openrouter',
  },
  'openrouter-Nvidia': {
    name: 'Nvidia/llama-3.1-nemotron-70b',
    apiKey: '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',
    endpoint: 'https://openrouter.ai/api/v1/chat/completions',
    model: 'nvidia/llama-3.1-nemotron-70b-instruct:free',
    type: 'openrouter',
  },
  'openrouter-Qwen2.5 72B': {
    name: 'Qwen2.5 72B Instruct',
    apiKey: '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',
    endpoint: 'https://openrouter.ai/api/v1/chat/completions',
    model: 'qwen/qwen-2.5-72b-instruct:free',
    type: 'openrouter',
  },
};

app.get('/', (req, res) => {
  res.send('欢迎使用 AI 聊天服务器！');
});
// 获取可用模型列表
app.get('/api/models', (req, res) => {
  const modelList = Object.keys(AI_MODELS).map(key => ({
    id: key,
    name: AI_MODELS[key].name
  }));
  res.json(modelList);
});

// 处理聊天请求
app.post("/api/chat", async (req, res) => {
    try {
      const { modelId, messages } = req.body
  
      if (!modelId || !AI_MODELS[modelId]) {
        return res.status(400).json({ error: "无效的模型ID" })
      }
  
      const modelConfig = AI_MODELS[modelId]
  
      // 设置响应头以支持流式传输
      res.setHeader("Content-Type", "text/event-stream")
      res.setHeader("Cache-Control", "no-cache")
      res.setHeader("Connection", "keep-alive")
  
      // 根据不同的模型提供商调整请求格式
      let requestBody
      const headers = {
        "Content-Type": "application/json",
      }
  
      if (modelConfig.type === "openrouter") {
        headers["Authorization"] = `Bearer ${modelConfig.apiKey}`
        requestBody = {
          model: modelConfig.model,
          messages,
          stream: true,
        }
      }
      // 发送请求到AI提供商
      const aiResponse = await fetch(modelConfig.endpoint, {
        method: "POST",
        headers,
        body: JSON.stringify(requestBody),
      })
  
      if (!aiResponse.ok) {
        const errorText = await aiResponse.text()
        console.error("AI提供商错误:", errorText)
        return res.status(aiResponse.status).json({
          error: `AI提供商错误: ${aiResponse.status}`,
          details: errorText,
        })
      }
  
      // 流式传输响应，但只提取内容部分
      const reader = aiResponse.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ""
  
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
  
        buffer += decoder.decode(value, { stream: true })
  
        // 处理缓冲区中的每一行
        const lines = buffer.split("\n")
        buffer = lines.pop() || "" // 保留最后一个不完整的行
  
        for (const line of lines) {
          if (line.trim() === "") continue
  
          if (line.startsWith("data: ")) {
            const data = line.slice(6).trim()
  
            if (data === "[DONE]") {
              res.write("data: [DONE]\n\n")
              continue
            }
  
            try {
              const parsed = JSON.parse(data)
              let content = ""
  
              // 根据不同的 AI 提供商提取内容
              if (modelConfig.type === "openai" || modelConfig.type === "openrouter") {
                if (parsed.choices && parsed.choices[0] && parsed.choices[0].delta && parsed.choices[0].delta.content) {
                  content = parsed.choices[0].delta.content
                }
              } else if (modelConfig.type === "anthropic") {
                if (parsed.delta && parsed.delta.text) {
                  content = parsed.delta.text
                }
              }
  
              // 只发送实际内容
              if (content) {
                res.write(`data: ${JSON.stringify({ content })}\n\n`)
              }
            } catch (e) {
              console.error("解析JSON失败:", e, "Line:", line)
            }
          }
        }
      }
  
      res.write("data: [DONE]\n\n")
      res.end()
    } catch (error) {
      console.error("处理聊天请求时出错:", error)
      res.status(500).json({ error: "服务器内部错误" })
    }
  })

// 文件上传端点
app.post('/api/upload', upload.single('file'), (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: '没有文件被上传' });
    }
    
    const fileInfo = {
      filename: req.file.filename,
      originalname: req.file.originalname,
      mimetype: req.file.mimetype,
      size: req.file.size,
      path: req.file.path
    };
    
    res.json({ success: true, file: fileInfo });
  } catch (error) {
    console.error('文件上传错误:', error);
    res.status(500).json({ error: '文件上传失败' });
  }
});

// 启动服务器
server.listen(PORT, () => {
  console.log(`服务器运行在 http://localhost:${PORT}`);
});

// 示例环境变量
console.log(`
请确保在.env文件中设置以下环境变量:
OPENAI_API_KEY=your_openai_api_key
OPENROUTER_API_KEY=your_openrouter_api_key
ANTHROPIC_API_KEY=your_anthropic_api_key
`);