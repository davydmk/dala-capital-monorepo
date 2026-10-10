import { Logger, ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import cookieParser from 'cookie-parser';
import { AppModule } from './app.module.js';

const logger = new Logger('Bootstrap');

/**
 * Узел Solana отвечает ошибкой не через промис, а через колбэк внутри
 * web3.js, поэтому при 429 от публичного RPC исключение проходит мимо всех
 * try/catch и роняет процесс. Чужая перегрузка не повод останавливать API:
 * пишем в лог и работаем дальше, запрос упадёт сам по себе.
 */
for (const event of ['uncaughtException', 'unhandledRejection'] as const) {
  process.on(event, (error: unknown) => {
    logger.error(`${event}: ${error instanceof Error ? error.stack : String(error)}`);
  });
}

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  app.use(cookieParser());
  // Лишние поля в теле запроса отбрасываются, типы приводятся по DTO.
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );
  // Сессия живёт в куке, поэтому фронту нужен доступ с учётными данными.
  app.enableCors({
    origin: process.env.CORS_ORIGIN?.split(',') ?? ['http://localhost:3000'],
    credentials: true,
  });

  await app.listen(process.env.PORT ?? 3001);
}
await bootstrap();
