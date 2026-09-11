import { ConsoleLoggerOptions } from '@nestjs/common';
import { registerAs } from '@nestjs/config';

import { getLogLevels } from '../lib/logger';

export default registerAs('logger', (): ConsoleLoggerOptions => ({
  colors: process.env.LOGGER_COLORS_ENABLED === 'true', // Default to false
  json: process.env.LOGGER_JSON_ENABLED !== 'false', // Default to true
  logLevels: getLogLevels(process.env.LOG_LEVEL ?? 'info'),
}));
