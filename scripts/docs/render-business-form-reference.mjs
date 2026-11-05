import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../docs/reference/business-form');
const source=fs.readFileSync(path.join(root,'README.md'),'utf8');
const escape=s=>s.replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;');
const inline=s=>escape(s).replace(/\*\*([^*]+)\*\*/g,'<strong>$1</strong>').replace(/`([^`]+)`/g,'<code>$1</code>').replace(/\[([^\]]+)\]\(([^)]+)\)/g,(_,label,href)=>`<a href="${href.endsWith('.md')&&!href.startsWith('assets/')?'related/'+href.split('/').pop():href}">${label}</a>`);
let out=[],nav=[],code=false,codeLines=[],para=[],list=false;
const flush=()=>{if(para.length){out.push('<p>'+inline(para.join(' '))+'</p>');para=[];}if(list){out.push('</ul>');list=false;}};
for(const line of source.split('\n')){
  if(line.startsWith('```')){if(code){out.push('<pre><code>'+escape(codeLines.join('\n'))+'</code></pre>');codeLines=[];code=false;}else{flush();code=true;}continue;}
  if(code){codeLines.push(line);continue;}
  if(!line.trim()){flush();continue;}
  const h=line.match(/^(#{1,3}) (.+)$/);if(h){flush();const n=h[1].length,id=n===2?'section-'+(nav.length+1):'';if(n===2)nav.push({id,label:h[2]});out.push(`<h${n}${id?' id="'+id+'"':''}>${inline(h[2])}</h${n}>`);continue;}
  const img=line.match(/^!\[([^\]]*)\]\(([^)]+)\)$/);if(img){flush();out.push(`<figure><a href="${img[2]}" target="_blank" rel="noopener"><img src="${img[2]}" alt="${escape(img[1])}" loading="lazy"></a><figcaption>${escape(img[1])} · 点击查看原图</figcaption></figure>`);continue;}
  if(line.startsWith('- ')){if(para.length){out.push('<p>'+inline(para.join(' '))+'</p>');para=[];}if(!list){out.push('<ul>');list=true;}out.push('<li>'+inline(line.slice(2))+'</li>');continue;}
  para.push(line.trim());
}
flush();
fs.mkdirSync(path.join(root,'related'),{recursive:true});
fs.writeFileSync(path.join(root,'related/business-form-from-scratch.md'),fs.readFileSync(path.resolve(root,'../../development/business-form-from-scratch.md'),'utf8').replaceAll('../reference/business-form/README.md','../README.md'));
fs.writeFileSync(path.join(root,'index.html'),`<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>业务表单定义 · UI、架构与交互参考</title><style>
*{box-sizing:border-box}html{scroll-behavior:smooth;scroll-padding-top:28px}body{margin:0;background:#f5f7f9;color:#283846;font:16px/1.85 -apple-system,BlinkMacSystemFont,'PingFang SC','Microsoft YaHei',sans-serif}a{color:#225f79;text-underline-offset:4px}aside{width:260px;position:fixed;inset:0 auto 0 0;padding:32px 22px;overflow:auto;background:#edf1f4;border-right:1px solid #d7dfe5}aside strong{display:block;font-size:19px;margin-bottom:8px}aside small{color:#697d8b}nav{margin-top:24px}nav a{display:block;font-size:14px;text-decoration:none;margin:5px 0;padding:6px 8px;border-radius:4px}nav a:hover,nav a:focus{background:#dce8ee;color:#163f53}main{margin-left:260px;padding:40px 42px 96px;max-width:1550px}h1{font-size:30px;line-height:1.4;margin:0 0 24px}h2{font-size:23px;margin:64px 0 18px;padding-top:20px;border-top:1px solid #d7dfe5}h3{font-size:18px;margin:30px 0 10px}p{max-width:1000px;margin:14px 0}li{margin:7px 0}ul{padding-left:24px;max-width:1060px}figure{margin:24px 0 32px;background:#fff;border:1px solid #d7dfe5;border-radius:6px;overflow:hidden}figure a{display:block}img{width:100%;height:auto;display:block}figcaption{padding:9px 16px;font-size:13px;color:#607381;background:#f4f7fa}pre{padding:24px;background:#eaf0f4;overflow:auto;font:14px/1.65 ui-monospace,SFMono-Regular,Consolas,monospace;border-radius:5px}p code,li code{background:#e6edf2;padding:2px 5px;border-radius:3px}header{font-size:13px;color:#607381;margin-bottom:18px}.print{display:inline-block;margin-top:20px;font-size:13px}@media(max-width:900px){aside{position:static;width:auto;border-right:0;border-bottom:1px solid #d7dfe5;padding:22px}nav{display:flex;gap:4px 12px;flex-wrap:wrap;margin-top:12px}nav a{padding:2px;font-size:12px;margin:0}main{margin:0;padding:28px 18px}h1{font-size:25px}h2{font-size:21px}}@media print{aside{display:none}main{margin:0;padding:0;max-width:none}body{background:#fff;font-size:11pt}figure,pre{break-inside:avoid}h2,h3{break-after:avoid}h2{margin-top:28px}a{color:inherit}figcaption{font-size:9pt}}
</style></head><body><aside><strong>业务表单定义</strong><small>现有 UI · 架构 · 交互参考</small><nav>${nav.map(n=>`<a href="#${n.id}">${escape(n.label)}</a>`).join('')}</nav><span class="print">可离线阅读，也可使用浏览器打印为 PDF。<br>截图为历史参考；架构与交互按源码核对。</span></aside><main><header>开发参考资料 / 2026-10-28</header>${out.join('\n')}</main></body></html>`);
const assets=fs.readdirSync(path.join(root,'assets'));
for(const f of assets){if(!fs.statSync(path.join(root,'assets',f)).size)throw new Error('Empty asset '+f);}
const html=fs.readFileSync(path.join(root,'index.html'),'utf8');
for(const m of html.matchAll(/(?:src|href)="([^"#]+)"/g)){if(!fs.existsSync(path.resolve(root,m[1])))throw new Error('Missing offline asset '+m[1]);}
for(const m of source.matchAll(/```json\n([\s\S]*?)```/g))JSON.parse(m[1]);
console.log(`Offline HTML ready: ${nav.length} sections, ${assets.length} images; links and JSON checked.`);
