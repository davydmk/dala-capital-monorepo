import { randomUUID } from 'node:crypto';
import { mkdir, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

export const MAX_DOCUMENT_BYTES = 10 * 1024 * 1024;
export const MAX_LOGO_BYTES = 2 * 1024 * 1024;
export const MAX_PHOTO_BYTES = 5 * 1024 * 1024;
export const DOCUMENT_MIME_TYPES = [
  'application/pdf',
  'image/jpeg',
  'image/png',
];
export const IMAGE_MIME_TYPES = ['image/jpeg', 'image/png'];

const EXTENSION: Record<string, string> = {
  'application/pdf': '.pdf',
  'image/jpeg': '.jpg',
  'image/png': '.png',
};

/**
 * Файлы лежат на диске, в базе — только метаданные.
 * Имя на диске задаём сами: присланное имя в пути не участвует, иначе им можно
 * выйти за каталог загрузок.
 */
@Injectable()
export class StorageService {
  private readonly root: string;

  constructor(config: ConfigService) {
    this.root = path.resolve(config.get<string>('UPLOADS_DIR') ?? './uploads');
  }

  /** `scope` — область: borrowers или investors; файлы разных ролей не смешиваются. */
  async save(
    scope: 'borrowers' | 'investors',
    ownerId: string,
    mimeType: string,
    content: Buffer,
  ): Promise<string> {
    const directory = path.join(this.root, scope, ownerId);
    await mkdir(directory, { recursive: true });

    const storageKey = path.posix.join(
      scope,
      ownerId,
      `${randomUUID()}${EXTENSION[mimeType] ?? ''}`,
    );
    await writeFile(path.join(this.root, storageKey), content);
    return storageKey;
  }

  absolutePath(storageKey: string): string {
    return path.join(this.root, storageKey);
  }

  /** Файла может не быть, если его удалили мимо приложения — это не ошибка. */
  async remove(storageKey: string): Promise<void> {
    await unlink(this.absolutePath(storageKey)).catch(() => undefined);
  }
}
