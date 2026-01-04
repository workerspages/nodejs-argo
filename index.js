const express = require("express");
const app = express();
const axios = require("axios");
const os = require('os');
const fs = require("fs");
const path = require("path");
const { promisify } = require('util');
const exec = promisify(require('child_process').exec);
const { execSync } = require('child_process'); 

// ================= 核心配置 =================
const UPLOAD_URL = process.env.UPLOAD_URL || '';      
const PROJECT_URL = process.env.PROJECT_URL || '';    
const AUTO_ACCESS = process.env.AUTO_ACCESS || false; 
const FILE_PATH = process.env.FILE_PATH || './tmp';   
const SUB_PATH = process.env.SUB_PATH || 'chamomile-dollar-chatter';                   // 订阅路径

// 端口配置
const PORT = process.env.SERVER_PORT || process.env.PORT || 3000; // 公网主端口（Xray监听）
const WEB_PORT = 4000;                                            // 伪装网页端口（本地）
const ARGO_PORT = process.env.ARGO_PORT || 8001;                  // 固定隧道端口,使用token需在cloudflare后台设置和这里一致

const UUID = process.env.UUID || 'f3cb90ed-1c8b-474a-8e80-c27a7f3bbe8e'; // 使用哪吒v1,在不同的平台运行需修改UUID,否则会覆盖
const NEZHA_SERVER = process.env.NEZHA_SERVER || '';        
const NEZHA_PORT = process.env.NEZHA_PORT || '';            
const NEZHA_KEY = process.env.NEZHA_KEY || '';              
const ARGO_DOMAIN = process.env.ARGO_DOMAIN || 'oracle-nodejs-argo.vpsdomain.eu.org';          // 固定隧道域名,留空即启用临时隧道  
const ARGO_AUTH = process.env.ARGO_AUTH || 'eyJhIjoiNGQxNDIzYzVlOGNkNGZhN2E4OTM1ZGI0ZmNiNWY0YjUiLCJ0IjoiNjQ2ZDFjYTItOTRkYi00OGMyLTllZjctN2Q3OGZlYzZhZjM5IiwicyI6Ik5qRm1NMlprTjJRdE5EZzBNQzAwWW1GakxUaG1ZMll0WVRsaU1qZ3pZV0poTnpVMCJ9';              // 固定隧道密钥json或token,留空即启用临时隧道,json获取地址：https://json.zone.id  
const CFIP = process.env.CFIP || 'cdns.doon.eu.org';        // 节点优选域名或优选ip  
const CFPORT = process.env.CFPORT || 443;                   
const NAME = process.env.NAME || 'Oracle';                        // 节点名称       

// 创建运行文件夹
if (!fs.existsSync(FILE_PATH)) {
  fs.mkdirSync(FILE_PATH);
  console.log(`${FILE_PATH} is created`);
} else {
  console.log(`${FILE_PATH} already exists`);
}

// 随机文件名生成
function generateRandomName() {
  const characters = 'abcdefghijklmnopqrstuvwxyz';
  let result = '';
  for (let i = 0; i < 6; i++) {
    result += characters.charAt(Math.floor(Math.random() * characters.length));
  }
  return result;
}

const npmName = generateRandomName();
const webName = generateRandomName();
const botName = generateRandomName();
const phpName = generateRandomName();
let npmPath = path.join(FILE_PATH, npmName);
let phpPath = path.join(FILE_PATH, phpName);
let webPath = path.join(FILE_PATH, webName);
let botPath = path.join(FILE_PATH, botName);
let subPath = path.join(FILE_PATH, 'sub.txt');
let listPath = path.join(FILE_PATH, 'list.txt');
let bootLogPath = path.join(FILE_PATH, 'boot.log');
let configPath = path.join(FILE_PATH, 'config.json');

// 删除旧节点逻辑（保留原样）
function deleteNodes() {
  try {
    if (!UPLOAD_URL || !fs.existsSync(subPath)) return;
    let fileContent = fs.readFileSync(subPath, 'utf-8');
    const decoded = Buffer.from(fileContent, 'base64').toString('utf-8');
    const nodes = decoded.split('\n').filter(line => /(vless|vmess|trojan|hysteria2|tuic):\/\//.test(line));
    if (nodes.length === 0) return;
    axios.post(`${UPLOAD_URL}/api/delete-nodes`, JSON.stringify({ nodes }), { headers: { 'Content-Type': 'application/json' } }).catch(()=>{});
  } catch (err) {}
}

function cleanupOldFiles() {
  try {
    const files = fs.readdirSync(FILE_PATH);
    files.forEach(file => {
      try {
        if (fs.statSync(path.join(FILE_PATH, file)).isFile()) fs.unlinkSync(path.join(FILE_PATH, file));
      } catch (e) {}
    });
  } catch (e) {}
}

// ================= 精美伪装网页 =================
const htmlContent = `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <title>System Maintenance</title>
    <style>
        body{font-family:'Segoe UI',Tahoma,Geneva,Verdana,sans-serif;background-color:#f4f4f9;color:#333;display:flex;justify-content:center;align-items:center;height:100vh;margin:0}
        .container{text-align:center;background:white;padding:50px;border-radius:10px;box-shadow:0 4px 6px rgba(0,0,0,0.1)}
        h1{color:#e74c3c;font-size:2.5rem;margin-bottom:10px}
        p{font-size:1.2rem;color:#666;margin-bottom:30px}
        .loader{border:5px solid #f3f3f3;border-top:5px solid #3498db;border-radius:50%;width:50px;height:50px;animation:spin 2s linear infinite;margin:0 auto}
        @keyframes spin{0%{transform:rotate(0deg)}100%{transform:rotate(360deg)}}
    </style>
</head>
<body>
    <div class="container">
        <h1>Under Maintenance</h1>
        <p>System is currently undergoing scheduled updates.<br>Services will resume shortly.</p>
        <div class="loader"></div>
    </div>
</body>
</html>
`;

// Express 监听本地 WEB_PORT (4000)
app.get("/", function(req, res) {
  res.setHeader('Content-Type', 'text/html');
  res.send(htmlContent);
});

// ================= Xray 配置文件生成 =================
async function generateConfig() {
  const config = {
    log: { access: '/dev/null', error: '/dev/null', loglevel: 'none' },
    inbounds: [
      // --- 1. 直连主入口 (监听公网 PORT) ---
      {
        port: parseInt(PORT),
        protocol: 'vless',
        settings: {
          clients: [{ id: UUID }],
          decryption: 'none',
          fallbacks: [
            { dest: WEB_PORT },                    // 默认回落到伪装网页
            { path: '/vless', dest: 4001 },        // 直连 VLESS WS
            { path: '/vmess', dest: 4002 },        // 直连 VMess WS
            { path: '/trojan', dest: 4003 }        // 直连 Trojan WS
          ]
        },
        streamSettings: { network: 'tcp' }
      },
      // --- 2. 直连分流节点 (本地监听) ---
      { port: 4001, listen: "127.0.0.1", protocol: "vless", settings: { clients: [{ id: UUID }], decryption: "none" }, streamSettings: { network: "ws", wsSettings: { path: "/vless" } } },
      { port: 4002, listen: "127.0.0.1", protocol: "vmess", settings: { clients: [{ id: UUID }] }, streamSettings: { network: "ws", wsSettings: { path: "/vmess" } } },
      { port: 4003, listen: "127.0.0.1", protocol: "trojan", settings: { clients: [{ password: UUID }] }, streamSettings: { network: "ws", security: "none", wsSettings: { path: "/trojan" } } },

      // --- 3. Argo 隧道节点 (保持原样) ---
      { port: ARGO_PORT, protocol: 'vless', settings: { clients: [{ id: UUID, flow: 'xtls-rprx-vision' }], decryption: 'none', fallbacks: [{ dest: 3001 }, { path: "/vless-argo", dest: 3002 }, { path: "/vmess-argo", dest: 3003 }, { path: "/trojan-argo", dest: 3004 }] }, streamSettings: { network: 'tcp' } },
      { port: 3001, listen: "127.0.0.1", protocol: "vless", settings: { clients: [{ id: UUID }], decryption: "none" }, streamSettings: { network: "tcp", security: "none" } },
      { port: 3002, listen: "127.0.0.1", protocol: "vless", settings: { clients: [{ id: UUID, level: 0 }], decryption: "none" }, streamSettings: { network: "ws", security: "none", wsSettings: { path: "/vless-argo" } }, sniffing: { enabled: true, destOverride: ["http", "tls", "quic"], metadataOnly: false } },
      { port: 3003, listen: "127.0.0.1", protocol: "vmess", settings: { clients: [{ id: UUID, alterId: 0 }] }, streamSettings: { network: "ws", wsSettings: { path: "/vmess-argo" } }, sniffing: { enabled: true, destOverride: ["http", "tls", "quic"], metadataOnly: false } },
      { port: 3004, listen: "127.0.0.1", protocol: "trojan", settings: { clients: [{ password: UUID }] }, streamSettings: { network: "ws", security: "none", wsSettings: { path: "/trojan-argo" } }, sniffing: { enabled: true, destOverride: ["http", "tls", "quic"], metadataOnly: false } },
    ],
    outbounds: [ { protocol: "freedom", tag: "direct" }, {protocol: "blackhole", tag: "block"} ]
  };
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
}

// 系统架构检测
function getSystemArchitecture() {
  const arch = os.arch();
  return (arch === 'arm' || arch === 'arm64' || arch === 'aarch64') ? 'arm' : 'amd';
}

// 下载函数
function downloadFile(fileName, fileUrl, callback) {
  const writer = fs.createWriteStream(fileName);
  axios({ method: 'get', url: fileUrl, responseType: 'stream' })
    .then(response => {
      response.data.pipe(writer);
      writer.on('finish', () => { writer.close(); callback(null, fileName); });
      writer.on('error', err => { fs.unlink(fileName, () => {}); callback(err.message); });
    })
    .catch(err => callback(err.message));
}

// 下载核心文件
async function downloadFilesAndRun() {  
  const architecture = getSystemArchitecture();
  const filesToDownload = getFilesForArchitecture(architecture);

  const downloadPromises = filesToDownload.map(fileInfo => {
    return new Promise((resolve, reject) => {
      downloadFile(fileInfo.fileName, fileInfo.fileUrl, (err) => err ? reject(err) : resolve());
    });
  });

  try {
    await Promise.all(downloadPromises);
  } catch (err) { return; }

  function authorizeFiles(filePaths) {
    filePaths.forEach(filePath => {
      if (fs.existsSync(filePath)) fs.chmodSync(filePath, 0o775);
    });
  }
  authorizeFiles([npmPath, webPath, botPath, phpPath]);

  // 运行 Nezha
  if (NEZHA_SERVER && NEZHA_KEY) {
    if (!NEZHA_PORT) {
        const configYaml = `client_secret: ${NEZHA_KEY}\nserver: ${NEZHA_SERVER}\ntls: true\nuuid: ${UUID}`;
        fs.writeFileSync(path.join(FILE_PATH, 'config.yaml'), configYaml);
        exec(`nohup ${phpPath} -c "${FILE_PATH}/config.yaml" >/dev/null 2>&1 &`).catch(()=>{});
        console.log(`${phpName} (Nezha V1) is running`);
    } else {
        const tls = ['443', '8443', '2096'].includes(NEZHA_PORT) ? '--tls' : '';
        exec(`nohup ${npmPath} -s ${NEZHA_SERVER}:${NEZHA_PORT} -p ${NEZHA_KEY} ${tls} --disable-auto-update --skip-conn --skip-procs >/dev/null 2>&1 &`).catch(()=>{});
        console.log(`${npmName} (Nezha V0) is running`);
    }
  }

  // 运行 Xray
  exec(`nohup ${webPath} -c ${configPath} >/dev/null 2>&1 &`)
    .then(() => console.log(`${webName} (Xray) is running`))
    .catch((e) => console.log(e));

  // 运行 Cloudflared
  if (fs.existsSync(botPath)) {
    let args = `tunnel --edge-ip-version auto --no-autoupdate --protocol http2 --logfile ${FILE_PATH}/boot.log --loglevel info --url http://localhost:${ARGO_PORT}`;
    if (ARGO_AUTH.match(/^[A-Z0-9a-z=]{120,250}$/)) args = `tunnel --edge-ip-version auto --no-autoupdate --protocol http2 run --token ${ARGO_AUTH}`;
    else if (ARGO_AUTH.match(/TunnelSecret/)) args = `tunnel --edge-ip-version auto --config ${FILE_PATH}/tunnel.yml run`;
    
    exec(`nohup ${botPath} ${args} >/dev/null 2>&1 &`).catch(()=>{});
    console.log(`${botName} (Argo) is running`);
  }
  await new Promise((resolve) => setTimeout(resolve, 5000));
}

// 依赖文件 URL (建议替换为自己的仓库)
function getFilesForArchitecture(architecture) {
  // 原脚本地址，如果需要更安全请替换为自己的 GitHub Raw 地址
  const REPO = "https://github.com/378278/bin/raw/main"; // 使用一个通用的备份源，或换回原脚本 ssss.nyc.mn
  let baseFiles = [
      { fileName: webPath, fileUrl: architecture === 'arm' ? `https://github.com/XTLS/Xray-core/releases/download/v1.8.4/Xray-linux-arm64-v8a.zip` : `https://github.com/XTLS/Xray-core/releases/download/v1.8.4/Xray-linux-64.zip` }, // 这里需要解压逻辑，为保证运行，还是用原脚本源
  ];
  
  // 恢复原脚本源以确保兼容性（因为没有 Unzip 逻辑）
  if (architecture === 'arm') {
    baseFiles = [
      { fileName: webPath, fileUrl: "https://arm64.ssss.nyc.mn/web" },
      { fileName: botPath, fileUrl: "https://arm64.ssss.nyc.mn/bot" }
    ];
  } else {
    baseFiles = [
      { fileName: webPath, fileUrl: "https://amd64.ssss.nyc.mn/web" },
      { fileName: botPath, fileUrl: "https://amd64.ssss.nyc.mn/bot" }
    ];
  }

  if (NEZHA_SERVER && NEZHA_KEY) {
    if (NEZHA_PORT) {
        baseFiles.unshift({ fileName: npmPath, fileUrl: architecture === 'arm' ? "https://arm64.ssss.nyc.mn/agent" : "https://amd64.ssss.nyc.mn/agent" });
    } else {
        baseFiles.unshift({ fileName: phpPath, fileUrl: architecture === 'arm' ? "https://arm64.ssss.nyc.mn/v1" : "https://amd64.ssss.nyc.mn/v1" });
    }
  }
  return baseFiles;
}

// 隧道配置处理
function argoType() {
  if (!ARGO_AUTH || !ARGO_DOMAIN) return;
  if (ARGO_AUTH.includes('TunnelSecret')) {
    fs.writeFileSync(path.join(FILE_PATH, 'tunnel.json'), ARGO_AUTH);
    const tunnelYaml = `tunnel: ${ARGO_AUTH.split('"')[11]}\ncredentials-file: ${path.join(FILE_PATH, 'tunnel.json')}\nprotocol: http2\ningress:\n  - hostname: ${ARGO_DOMAIN}\n    service: http://localhost:${ARGO_PORT}\n    originRequest:\n      noTLSVerify: true\n  - service: http_status:404`;
    fs.writeFileSync(path.join(FILE_PATH, 'tunnel.yml'), tunnelYaml);
  }
}
argoType();

// 提取域名并生成订阅
async function extractDomains() {
  await new Promise(r => setTimeout(r, 5000)); // 等待启动

  // 1. 获取公网 IP (用于直连节点)
  let publicIP = '127.0.0.1';
  try { publicIP = execSync('curl -s --max-time 5 ifconfig.me', { encoding: 'utf-8' }).trim(); } catch (e) {}

  // 2. 获取 Argo 域名
  let argoDomain = ARGO_DOMAIN;
  if (!argoDomain) {
    try {
        const log = fs.readFileSync(bootLogPath, 'utf-8');
        const match = log.match(/https?:\/\/([^ ]*trycloudflare\.com)/);
        if (match) argoDomain = match[1];
    } catch (e) {}
  }

  // 3. 生成节点信息
  const ISP = "Cloud"; 
  const nodeName = NAME ? NAME : ISP;
  
  // --- Argo 节点 (3个) ---
  const vmessArgo = { v: '2', ps: `${nodeName}-Argo-VMess`, add: CFIP, port: CFPORT, id: UUID, aid: '0', scy: 'none', net: 'ws', type: 'none', host: argoDomain, path: '/vmess-argo?ed=2560', tls: 'tls', sni: argoDomain, alpn: '', fp: 'chrome'};
  const argoLinks = `
vless://${UUID}@${CFIP}:${CFPORT}?encryption=none&security=tls&sni=${argoDomain}&fp=chrome&type=ws&host=${argoDomain}&path=%2Fvless-argo%3Fed%3D2560#${nodeName}-Argo-VLESS
vmess://${Buffer.from(JSON.stringify(vmessArgo)).toString('base64')}
trojan://${UUID}@${CFIP}:${CFPORT}?security=tls&sni=${argoDomain}&fp=chrome&type=ws&host=${argoDomain}&path=%2Ftrojan-argo%3Fed%3D2560#${nodeName}-Argo-Trojan
`;

  // --- 直连节点 (3个) ---
  // 使用 WS 模式以获得更好的兼容性(支持CDN/Direct混用)
  const vmessDirect = { v: '2', ps: `${nodeName}-Direct-VMess`, add: publicIP, port: PORT, id: UUID, aid: '0', scy: 'none', net: 'ws', type: 'none', host: publicIP, path: '/vmess', tls: 'none', sni: '', alpn: '', fp: 'chrome'};
  const directLinks = `
vless://${UUID}@${publicIP}:${PORT}?encryption=none&security=none&type=ws&host=${publicIP}&path=%2Fvless#${nodeName}-Direct-VLESS
vmess://${Buffer.from(JSON.stringify(vmessDirect)).toString('base64')}
trojan://${UUID}@${publicIP}:${PORT}?security=none&type=ws&host=${publicIP}&path=%2Ftrojan#${nodeName}-Direct-Trojan
`;

  const finalSub = (argoDomain ? argoLinks : "") + directLinks;
  const base64Content = Buffer.from(finalSub).toString('base64');
  
  console.log("================ LINKS ================");
  console.log(finalSub);
  console.log("=======================================");

  fs.writeFileSync(subPath, base64Content);
  
  app.get(`/${SUB_PATH}`, (req, res) => {
    res.send(base64Content);
  });
  
  uploadNodes(finalSub);
}

async function uploadNodes(nodesTxt) {
  if (!UPLOAD_URL) return;
  // 简化的上传逻辑，适配 mix
  const nodes = nodesTxt.split('\n').filter(n => n.trim() !== '');
  try {
     if(PROJECT_URL) await axios.post(`${UPLOAD_URL}/api/add-subscriptions`, { subscription: [`${PROJECT_URL}/${SUB_PATH}`] });
     else await axios.post(`${UPLOAD_URL}/api/add-nodes`, { nodes: nodes });
  } catch(e) {}
}

// 垃圾清理
function cleanFiles() {
  setTimeout(() => {
    const files = [bootLogPath, configPath, webPath, botPath, npmPath, phpPath];
    files.forEach(f => { if(fs.existsSync(f)) fs.unlink(f, ()=>{}); });
  }, 90000);
}
cleanFiles();

async function AddVisitTask() {
  if (!AUTO_ACCESS || !PROJECT_URL) return;
  try { await axios.post('https://oooo.serv00.net/add-url', { url: PROJECT_URL }); } catch (e) {}
}

async function startserver() {
  deleteNodes();
  cleanupOldFiles();
  await generateConfig();
  await downloadFilesAndRun();
  await extractDomains();
  await AddVisitTask();
}

startserver();

// 启动 Express (监听 WEB_PORT)
app.listen(WEB_PORT, () => console.log(`Web server running on internal port: ${WEB_PORT}`));
