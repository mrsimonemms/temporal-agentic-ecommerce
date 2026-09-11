import { ConsoleLoggerOptions } from '@nestjs/common';
import { registerAs } from '@nestjs/config';

export default registerAs('logger', (): ConsoleLoggerOptions => ({
  colors: process.env.LOGGER_COLORS_ENABLED === 'true', // Default to false
  json: process.env.LOGGER_JSON_ENABLED !== 'false', // Default to true
}));
