import type { Params } from 'nestjs-pino';
import { stdTimeFunctions } from 'pino';

import type { Config } from '../config/config.js';
import { isOperationalPath } from '../routes.js';
import { APP_VERSION } from '../version.js';
import { REQUEST_ID_HEADER, resolveRequestId } from './request-id.js';

/** JSON logs with the same base fields the Go worker uses: time, level, msg and service. */
export function loggerOptions(config: Config): Params {
  return {
    pinoHttp: {
      level: config.logLevel,
      base: { service: 'api', version: APP_VERSION },
      timestamp: stdTimeFunctions.isoTime,
      formatters: { level: (label) => ({ level: label }) },
      genReqId: (req, res) => {
        const id = resolveRequestId(req.headers[REQUEST_ID_HEADER]);
        res.setHeader(REQUEST_ID_HEADER, id);
        return id;
      },
      customAttributeKeys: { reqId: 'requestId' },
      // Logs inside a request only carry the request id, not the whole request.
      quietReqLogger: true,
      // Headers are left out on purpose: they will carry credentials once auth exists.
      serializers: {
        req: (req: { method?: string; url?: string }) => ({ method: req.method, url: req.url }),
        res: (res: { statusCode?: number }) => ({ statusCode: res.statusCode }),
      },
      autoLogging: { ignore: (req) => isOperationalPath(req.url) },
    },
  };
}
