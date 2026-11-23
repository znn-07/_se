const PROTECTED = new Set([
  'POST /api/telemetry',
  'POST /api/demo',
  'DELETE /api/readings',
]);

function equalToken(left, right) {
  if (typeof left !== 'string' || typeof right !== 'string' || left.length !== right.length) {
    return false;
  }
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) {
    difference |= left.charCodeAt(index) ^ right.charCodeAt(index);
  }
  return difference === 0;
}

export function requiresToken(method, path) {
  return PROTECTED.has(`${method} ${path}`);
}

export function hasValidToken(request, env) {
  const expected = env.API_TOKEN ?? env.WRITE_TOKEN;
  if (!expected) return true;

  const header = request.headers.get('authorization') ?? '';
  const match = /^Bearer\s+(.+)$/i.exec(header);
  return match ? equalToken(match[1], expected) : false;
}
