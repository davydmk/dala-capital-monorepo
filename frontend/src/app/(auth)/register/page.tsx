import type { Metadata } from 'next';
import { RegisterForm } from './register-form';

export const metadata: Metadata = { title: 'Регистрация — Dala Capital' };

export default function RegisterPage() {
  return <RegisterForm />;
}
