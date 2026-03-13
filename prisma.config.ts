import { defineConfig } from '@prisma/config';
import dotenv from 'dotenv';

dotenv.config(); // Garante a leitura do arquivo .env

export default defineConfig({
  datasource: {
    url: process.env.DATABASE_URL,
  },
});