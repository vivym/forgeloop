import 'reflect-metadata';

import { NestFactory } from '@nestjs/core';

import { AppModule } from './app.module';

const bootstrap = async (): Promise<void> => {
  const app = await NestFactory.create(AppModule, { rawBody: true });
  app.enableCors({
    origin: process.env.FORGELOOP_WEB_ORIGIN ?? true,
  });
  await app.listen(process.env.PORT === undefined ? 3000 : Number(process.env.PORT));
};

void bootstrap();
