import http from 'node:http';
import app from '../dist/server/index.js';

const upstream = 'https://wedding.moaahub.com';
const publicOrigin = new URL(process.env.PUBLIC_ORIGIN || process.env.RENDER_EXTERNAL_URL || 'https://wedding-cn.moaahub.com').origin;
const port = Number(process.env.PORT || 8080);
const common = {'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'};
function error(res, status, message) {
  res.writeHead(status, {...common, 'Content-Type':'application/json; charset=utf-8'});
  res.end(JSON.stringify({error:message}));
}
export const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, publicOrigin);
    if (url.origin !== publicOrigin) return error(res,400,'잘못된 요청입니다.');
    if (url.pathname === '/healthz' && req.method === 'GET') {
      const response = await fetch(upstream + '/api/schedule', {
        redirect:'error', signal:AbortSignal.timeout(20000), headers:{Accept:'application/json'},
      });
      const data = await response.json();
      if (!response.ok || !Array.isArray(data.days) || data.days.length !== 3 ||
          data.days.some(day => !Array.isArray(day) || day.length !== 16 || day.some(cell =>
            typeof cell?.note !== 'string' || !Number.isSafeInteger(cell?.revision))) ||
          typeof data.memo?.note !== 'string' || !Number.isSafeInteger(data.memo?.revision)) {
        return error(res,503,'운영 일정 API 연결 확인에 실패했습니다.');
      }
      res.writeHead(200, {...common,'Content-Type':'application/json'});
      return res.end(JSON.stringify({ok:true, scheduleApi:'reachable'}));
    }
    if (url.pathname === '/api/schedule') {
      if (!['GET','PUT','POST'].includes(req.method)) return error(res,405,'지원하지 않는 요청입니다.');
      if (req.method !== 'GET' && req.headers.origin !== publicOrigin) return error(res,403,'페이지를 새로고침해 주세요.');
      let body;
      if (req.method !== 'GET') {
        if (!/^application\/json(?:\s*;|$)/i.test(req.headers['content-type'] || '')) return error(res,415,'JSON 요청이 필요합니다.');
        const chunks = []; let size = 0;
        for await (const chunk of req) {
          size += chunk.length;
          if (size > 512 * 1024) return error(res,413,'요청이 너무 큽니다.');
          chunks.push(chunk);
        }
        body = Buffer.concat(chunks);
      }
      const headers = {'Accept':'application/json'};
      if (body) Object.assign(headers, {'Content-Type':'application/json','Origin':upstream});
      const response = await fetch(upstream + '/api/schedule', {
        method:req.method, headers, body, redirect:'error', signal:AbortSignal.timeout(20000),
      });
      if (!(response.headers.get('content-type') || '').includes('application/json')) return error(res,502,'운영 일정 API에 연결할 수 없습니다.');
      res.writeHead(response.status, {...common, 'Content-Type':'application/json; charset=utf-8'});
      return res.end(await response.text());
    }
    if (req.method !== 'GET' || !['/','/admin','/assets/excel.js','/assets/schedule-template.xlsx'].includes(url.pathname)) return error(res,404,'페이지를 찾을 수 없습니다.');
    // Only UI/assets use the existing worker. No D1 binding or fallback database exists here.
    const response = await app.fetch(new Request(url), {});
    res.writeHead(response.status, Object.fromEntries(response.headers));
    res.end(Buffer.from(await response.arrayBuffer()));
  } catch {
    error(res,502,'운영 일정 API에 연결할 수 없습니다. 잠시 후 다시 시도해 주세요.');
  }
});
server.listen(port, '0.0.0.0', () => console.log(`Wedding server listening on ${port}`));
