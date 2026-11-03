import './tracing';
import { Logger } from 'nestjs-pino';
import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AppModule } from './app.module';
import { readListenPort } from './config/runtime-env';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { bufferLogs: true });
  app.useLogger(app.get(Logger));
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  app.enableCors();
  // Фоновий outbox relay має завершитись коректно на SIGTERM.
  app.enableShutdownHooks();
  const document = SwaggerModule.createDocument(
    app,
    new DocumentBuilder()
      .setTitle('ledger-service')
      .addBearerAuth()
      .addApiKey(
        { type: 'apiKey', in: 'header', name: 'x-internal-token' },
        'internal-token',
      )
      .build(),
  );
  SwaggerModule.setup('docs', app, document);
  const port = readListenPort();
  await app.listen(port);
  app.get(Logger).log(`ledger-service listening on ${port}`);
}
bootstrap();
