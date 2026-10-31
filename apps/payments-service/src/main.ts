import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  app.enableCors();
  // Saga runner і outbox relay мають завершитись коректно на SIGTERM.
  app.enableShutdownHooks();
  const document = SwaggerModule.createDocument(
    app,
    new DocumentBuilder().setTitle('payments-service').addBearerAuth().build(),
  );
  SwaggerModule.setup('docs', app, document);
  const port = process.env.PORT ?? 3002;
  await app.listen(port);
  // eslint-disable-next-line no-console
  console.log(`payments-service listening on ${port}`);
}
bootstrap();
