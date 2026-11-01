import { INestApplication, ValidationPipe } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';

export function configureApp(app: INestApplication) {
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  const document = SwaggerModule.createDocument(
    app,
    new DocumentBuilder().setTitle('bff').addBearerAuth().build(),
  );
  SwaggerModule.setup('docs', app, document);
}
