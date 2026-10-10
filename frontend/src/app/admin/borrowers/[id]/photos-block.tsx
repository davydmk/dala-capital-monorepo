'use client';

import { useMutation } from '@tanstack/react-query';
import { ChevronLeft, ChevronRight, ImagePlus, Trash2 } from 'lucide-react';
import { useRef } from 'react';
import { Button, Card, CardTitle, EmptyState, Notice } from '@/components/ui';
import { api, ApiError } from '@/lib/api';
import type { BorrowerPhoto } from '@/lib/types';

const MAX_PHOTOS = 8;

/** Фотографии предприятия: их инвестор увидит каруселью на витрине. */
export function PhotosBlock({
  id,
  photos,
  onChange,
}: {
  id: string;
  photos: BorrowerPhoto[];
  onChange: () => Promise<void>;
}) {
  const fileInput = useRef<HTMLInputElement>(null);

  const upload = useMutation<unknown, ApiError, File>({
    mutationFn: (file) => api.borrowers.addPhoto(id, file, ''),
    onSuccess: async () => {
      if (fileInput.current) fileInput.current.value = '';
      await onChange();
    },
  });

  const update = useMutation<
    unknown,
    ApiError,
    { photoId: string; caption?: string; sortOrder?: number }
  >({
    mutationFn: ({ photoId, ...input }) =>
      api.borrowers.updatePhoto(id, photoId, input),
    onSuccess: () => onChange(),
  });

  const remove = useMutation<void, ApiError, string>({
    mutationFn: (photoId) => api.borrowers.removePhoto(id, photoId),
    onSuccess: () => onChange(),
  });

  /** Меняет местами с соседом: перетаскивание на телефоне неудобно. */
  const move = (index: number, direction: -1 | 1) => {
    const current = photos[index];
    const neighbour = photos[index + direction];
    if (!neighbour) return;
    update.mutate({ photoId: current.id, sortOrder: neighbour.sortOrder });
    update.mutate({ photoId: neighbour.id, sortOrder: current.sortOrder });
  };

  return (
    <Card>
      <CardTitle>Фотографии предприятия</CardTitle>
      <p className="mb-3 text-sm text-muted">
        Цех, склад, магазин, команда — это увидит инвестор. До {MAX_PHOTOS}{' '}
        снимков, JPG или PNG до 5 МБ.
      </p>

      {upload.isError ? (
        <div className="mb-3">
          <Notice tone="danger" title={upload.error.message} />
        </div>
      ) : null}

      {photos.length === 0 ? (
        <EmptyState
          icon={<ImagePlus size={26} aria-hidden />}
          title="Фотографий пока нет"
        >
          Без снимков карточка выглядит как строка в таблице.
        </EmptyState>
      ) : (
        <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {photos.map((photo, index) => (
            <li
              key={photo.id}
              className="overflow-hidden rounded-lg border border-border"
            >
              {/* eslint-disable-next-line @next/next/no-img-element -- файл отдаёт наш API */}
              <img
                src={api.borrowers.photoUrl(id, photo.id)}
                alt={photo.caption ?? ''}
                className="aspect-4/3 w-full object-cover"
              />
              <input
                defaultValue={photo.caption ?? ''}
                placeholder="Подпись"
                aria-label="Подпись к фотографии"
                className="w-full border-t border-border bg-surface px-2 py-2 text-sm"
                onBlur={(event) => {
                  const caption = event.target.value.trim();
                  if (caption !== (photo.caption ?? '')) {
                    update.mutate({ photoId: photo.id, caption });
                  }
                }}
              />
              <div className="flex border-t border-border">
                <button
                  aria-label="Сдвинуть левее"
                  disabled={index === 0}
                  className="flex min-h-11 flex-1 items-center justify-center text-muted disabled:opacity-40"
                  onClick={() => move(index, -1)}
                >
                  <ChevronLeft size={18} />
                </button>
                <button
                  aria-label="Сдвинуть правее"
                  disabled={index === photos.length - 1}
                  className="flex min-h-11 flex-1 items-center justify-center text-muted disabled:opacity-40"
                  onClick={() => move(index, 1)}
                >
                  <ChevronRight size={18} />
                </button>
                <button
                  aria-label="Удалить фотографию"
                  className="flex min-h-11 flex-1 items-center justify-center text-muted hover:text-danger"
                  onClick={() => {
                    if (window.confirm('Удалить фотографию?'))
                      remove.mutate(photo.id);
                  }}
                >
                  <Trash2 size={18} />
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}

      <input
        ref={fileInput}
        type="file"
        accept="image/jpeg,image/png"
        className="hidden"
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) upload.mutate(file);
        }}
      />
      <Button
        variant="secondary"
        className="mt-3"
        loading={upload.isPending}
        disabled={photos.length >= MAX_PHOTOS}
        onClick={() => fileInput.current?.click()}
      >
        <ImagePlus size={18} aria-hidden /> Добавить фотографию
      </Button>
    </Card>
  );
}
