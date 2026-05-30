import 'reflect-metadata';

import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';

import { AppModule } from './app.module';
import { registerInternalArtifactUploadMiddleware } from './modules/internal-artifacts/internal-artifacts.constants';

const bootstrap = async (): Promise<void> => {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { bodyParser: false, rawBody: true });
  registerInternalArtifactUploadMiddleware(app.getHttpAdapter().getInstance());
  app.useBodyParser('json');
  app.useBodyParser('urlencoded', { extended: true });
  app.enableCors({
    origin: process.env.FORGELOOP_WEB_ORIGIN ?? true,
  });
  await app.listen(process.env.PORT === undefined ? 3000 : Number(process.env.PORT));
};

void bootstrap();
