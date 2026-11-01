import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AppModule } from './app.module';
import { configureApp } from './configure-app';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
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
  const port = process.env.PORT ?? 3003;
  await app.listen(port);
  // eslint-disable-next-line no-console
  console.log(`notifications-service listening on ${port}`);
}
bootstrap();
