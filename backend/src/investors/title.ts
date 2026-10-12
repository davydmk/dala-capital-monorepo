/**
 * Как назвать инвестора в документе: компанию — по названию, человека — по
 * имени и фамилии. Нужна на сервере, потому что выписку из реестра собирает
 * бэкенд, а не экран.
 *
 * Такая же функция живёт на фронте — `investorTitle` в списке инвесторов.
 * Это одна логика в двух рантаймах: меняя здесь, поправьте и там, иначе один
 * и тот же держатель окажется подписан по-разному в выписке и на экране.
 */
export interface InvestorNameFields {
  type: string;
  companyName: string | null;
  firstName: string | null;
  lastName: string | null;
}

export function investorTitle(investor: InvestorNameFields): string {
  if (investor.type === 'COMPANY') return investor.companyName ?? 'Компания';
  const name = `${investor.firstName ?? ''} ${investor.lastName ?? ''}`.trim();
  return name || 'Без имени';
}

/** Инвестор так, как он виден админу рядом с его бумагами. */
export interface InvestorBrief {
  investorId: string;
  /** INDIVIDUAL или COMPANY: в реестре тип держателя указывается всегда. */
  type: string;
  title: string;
  /** Страна по анкете; у незаполненной её может не быть. */
  country: string | null;
}
