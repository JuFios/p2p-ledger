import './tracing';
import { Logger } from 'nestjs-pino';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AppModule } from './app.module';
import { readListenPort } from './config/runtime-env';
import { configureApp } from './configure-app';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { bufferLogs: true });
  app.useLogger(app.get(Logger));
  configureApp(app);
  app.enableShutdownHooks();
  const document = SwaggerModule.createDocument(
    app,
    new DocumentBuilder()
      .setTitle('notifications-service')
      .addBearerAuth()
      .build(),
  );
  SwaggerModule.setup('docs', app, document);
  const port = readListenPort();
  await app.listen(port);
  app.get(Logger).log(`notifications-service listening on ${port}`);
}
bootstrap();
