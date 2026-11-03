import { ConflictException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { QueryFailedError, Repository } from 'typeorm';
import { AuthService } from '../src/auth/auth.service';
import { User } from '../src/auth/entities/user.entity';

const credentials = { email: 'race@example.com', password: 'password123' };
function setup(error: Error) {
  const users = {
    findOne: jest.fn(async () => null), create: jest.fn(value => value),
    save: jest.fn().mockRejectedValue(error),
  };
  const jwt = { sign: jest.fn() };
  return { users, jwt, service: new AuthService(users as unknown as Repository<User>, jwt as unknown as JwtService) };
}
const failure = (code: string, constraint: string) =>
  new QueryFailedError('INSERT INTO users', [], Object.assign(new Error('database error'), { code, constraint }));

it('returns a conflict when another request inserts the same email after lookup', async () => {
  const { service, jwt } = setup(failure('23505', 'UQ_97672ac88f789774dd47f7c8be3'));
  await expect(service.register(credentials)).rejects.toBeInstanceOf(ConflictException);
  expect(jwt.sign).not.toHaveBeenCalled();
});

it.each([
  failure('23505', 'users_pkey'),
  failure('23502', 'UQ_97672ac88f789774dd47f7c8be3'),
  new Error('connection lost'),
])('preserves unrelated storage failures: %s', async error => {
  const { service, jwt } = setup(error);
  await expect(service.register(credentials)).rejects.toBe(error);
  expect(jwt.sign).not.toHaveBeenCalled();
});
