import { Controller, Get } from '@nestjs/common';
import { listCountries } from './countries.js';

/**
 * Справочник стран для анкеты. Доступен любому вошедшему: он нужен и инвестору
 * в мастере, и админу — чтобы показать название вместо кода в карточке.
 */
@Controller('countries')
export class CountriesController {
  @Get()
  list() {
    return listCountries();
  }
}
