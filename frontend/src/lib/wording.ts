import type { ScheduleKind } from './types';

/**
 * Слова, которыми говорят про деньги до выдачи займа. У кредита это сбор,
 * взносы и кампания; у облигации — размещение, заявки и выпуск. Смысл один,
 * но инвестор в бумагах ждёт своих слов, а заёмщик по кредиту — своих.
 *
 * Держим одним словарём, а не тернарниками по экранам: так видно весь язык
 * сразу и не получается, что на одной странице «сбор», а на соседней
 * «размещение» про то же самое.
 */
export interface Wording {
  /** Как называется сама затея: кампания или выпуск. */
  entity: string;
  entityLower: string;
  /** Нижняя и верхняя границы того, сколько можно собрать. */
  softCap: string;
  hardCap: string;
  /** Сколько вкладывает один инвестор. */
  minTicket: string;
  maxTicket: string;
  /** Срок, до которого принимают деньги. */
  deadline: string;
  /** Сколько уже принято. */
  raised: string;
  raisedLower: string;
  /** Кнопка, открывающая инвестору адрес пополнения. */
  openDeposit: string;
  /** Кнопка оператора, которая подводит черту. */
  close: string;
  /** Напоминание в списке у админа. */
  closeDue: string;
  /** Подсказка у засечки минимума на полосе. */
  softCapHint: string;
}

const LOAN: Wording = {
  entity: 'Кампания',
  entityLower: 'кампания',
  softCap: 'Минимум сбора',
  hardCap: 'Максимум сбора',
  minTicket: 'Минимальный взнос',
  maxTicket: 'Максимальный взнос',
  deadline: 'Сбор до',
  raised: 'Собрано',
  raisedLower: 'собрано',
  openDeposit: 'Получить адрес для пополнения',
  close: 'Закрыть сбор',
  closeDue: 'сбор завершён, пора закрывать',
  softCapHint: 'минимум, при котором сбор состоится',
};

const BOND: Wording = {
  entity: 'Выпуск',
  entityLower: 'выпуск',
  softCap: 'Минимум размещения',
  hardCap: 'Максимум размещения',
  minTicket: 'Минимальная заявка',
  maxTicket: 'Максимальная заявка',
  deadline: 'Размещение до',
  raised: 'Размещено',
  raisedLower: 'размещено',
  openDeposit: 'Подать заявку',
  close: 'Подвести итоги размещения',
  closeDue: 'размещение закончилось, пора подводить итоги',
  softCapHint: 'минимум, при котором размещение состоится',
};

export const words = (kind: ScheduleKind | undefined): Wording =>
  kind === 'COUPON' ? BOND : LOAN;
