'use strict';

/**
 * Presenter: 介於 Model 與 View 之間的控制中樞。
 * 解析命令列參數 → 組出請求規格 (spec) → 呼叫 model.fetch → 依選項呼叫 view 呈現結果。
 * 不直接操作 HTTP，也不直接輸出文字（都透過 view）。
 */

const model = require('./model.js');
const view = require('./view.js');

const VERSION = '0.1.0';
const DEFAULT_TIMEOUT = 30;

class CliError extends Error {}

function parseArgs(argv) {
  const args = {
    url: null,
    method: null,
    headers: [],
    data: null,
    output: null,
    include: false,
    fail: false,
    head: false,
    location: false,
    silent: false,
    verbose: false,
    user: null,
    connectTimeout: null,
    maxTime: null,
    help: false,
    version: false,
  };

  const takeValue = (i, flag) => {
    const value = argv[i + 1];
    if (value === undefined) {
      throw new CliError(`option "${flag}" is missing a value`);
    }
    return value;
  };

  const addData = (value) => {
    args.data = args.data === null ? [value] : args.data.concat([value]);
  };

  // 每個旗標回傳「還多消耗了幾個 token」(0 或 1)。
  const flags = {
    '-X': () => ((args.method = takeValue(i, '-X').toUpperCase()), 1),
    '--request': () => ((args.method = takeValue(i, '--request').toUpperCase()), 1),
    '-H': () => (args.headers.push(takeValue(i, '-H')), 1),
    '--header': () => (args.headers.push(takeValue(i, '--header')), 1),
    '-d': () => (addData(takeValue(i, '-d')), 1),
    '--data': () => (addData(takeValue(i, '--data')), 1),
    '-o': () => ((args.output = takeValue(i, '-o')), 1),
    '--output': () => ((args.output = takeValue(i, '--output')), 1),
    '-f': () => ((args.fail = true), 0),
    '--fail': () => ((args.fail = true), 0),
    '-i': () => ((args.include = true), 0),
    '--include': () => ((args.include = true), 0),
    '-I': () => ((args.head = true), 0),
    '--head': () => ((args.head = true), 0),
    '-L': () => ((args.location = true), 0),
    '--location': () => ((args.location = true), 0),
    '-s': () => ((args.silent = true), 0),
    '--silent': () => ((args.silent = true), 0),
    '-v': () => ((args.verbose = true), 0),
    '--verbose': () => ((args.verbose = true), 0),
    '-u': () => ((args.user = takeValue(i, '-u')), 1),
    '--user': () => ((args.user = takeValue(i, '--user')), 1),
    '--connect-timeout': () =>
      ((args.connectTimeout = Number(takeValue(i, '--connect-timeout'))), 1),
    '--max-time': () => ((args.maxTime = Number(takeValue(i, '--max-time'))), 1),
    '-h': () => ((args.help = true), 0),
    '--help': () => ((args.help = true), 0),
    '--version': () => ((args.version = true), 0),
  };

  let i = 0;
  while (i < argv.length) {
    const arg = argv[i];
    const handler = flags[arg];
    if (handler) {
      const consumed = handler();
      i += 1 + consumed;
    } else if (arg.startsWith('-') && arg !== '-') {
      throw new CliError(`unknown option: ${arg}`);
    } else {
      if (args.url !== null) {
        throw new CliError(`too many arguments; URL is already set to '${args.url}'`);
      }
      args.url = arg;
      i += 1;
    }
  }

  return args;
}

function buildRequest(args) {
  const headers = {};
  for (const header of args.headers) {
    const idx = header.indexOf(':');
    if (idx === -1) {
      throw new CliError(`bad header syntax '${header}'`);
    }
    headers[header.slice(0, idx).trim()] = header.slice(idx + 1).trim();
  }

  if (args.user) {
    headers.Authorization = `Basic ${Buffer.from(args.user, 'utf-8').toString('base64')}`;
  }

  const method = args.method || (args.data !== null ? 'POST' : args.head ? 'HEAD' : 'GET');

  let body = null;
  if (args.data !== null) {
    body = Buffer.from(args.data.join('&'), 'utf-8');
    if (!('Content-Type' in headers)) {
      headers['Content-Type'] = 'application/x-www-form-urlencoded';
    }
  }

  return {
    url: args.url,
    method,
    headers,
    body,
    followRedirects: args.location,
    timeoutMs: (args.connectTimeout || args.maxTime || DEFAULT_TIMEOUT) * 1000,
    onRedirect: args.verbose
      ? (location) => view.renderVerboseNotice(`* following redirect to ${location}`)
      : null,
  };
}

async function main(argv) {
  const silentRequested = argv.includes('-s') || argv.includes('--silent');

  let args;
  try {
    args = parseArgs(argv);
  } catch (err) {
    if (!silentRequested) {
      view.renderError(err.message);
    }
    return 1;
  }

  if (args.version) {
    view.renderVersion(VERSION);
    return 0;
  }
  if (args.help) {
    view.renderHelp(VERSION);
    return 0;
  }
  if (args.url === null) {
    view.renderHelp(VERSION);
    return 2;
  }

  let spec;
  try {
    spec = buildRequest(args);
  } catch (err) {
    view.renderError(err.message);
    return 1;
  }

  if (args.verbose) {
    view.renderVerbose({
      method: spec.method,
      url: spec.url,
      headers: spec.headers,
    });
  }

  try {
    const response = await model.fetch(spec);

    const failOnHttpError = args.fail && response.status >= 400;
    if (failOnHttpError) {
      return 1;
    }

    if (args.include) {
      view.renderResponseIncludingHeaders(response);
    }

    if (args.output) {
      view.writeToFile(args.output, response.body);
      if (args.verbose) {
        view.renderVerboseNotice(`* finished transferring to '${args.output}'`);
      }
    } else if (!args.include) {
      view.writeBody(response.body);
    }
    return 0;
  } catch (err) {
    if (err instanceof model.HttpError) {
      if (!args.silent) {
        view.renderError(err.message);
      }
      return 1;
    }
    throw err;
  }
}

module.exports = { main, parseArgs, buildRequest, CliError };