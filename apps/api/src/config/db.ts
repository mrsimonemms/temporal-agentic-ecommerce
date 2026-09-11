import { registerAs } from '@nestjs/config';
import { MongooseModuleOptions } from '@nestjs/mongoose';

export default registerAs('db', (): MongooseModuleOptions => ({
  uri: process.env.DB_URI,
}));
