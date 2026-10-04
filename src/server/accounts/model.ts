import { createHash, randomBytes, scrypt, timingSafeEqual } from 'node:crypto';

export type Account = {
  username: string;
  salt: string;
  hash: string;
};

function hashPassword(password: string, salt: string): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(
      password,
      salt,
      64,
      {
        N: 16384,
        r: 8,
        p: 1,
      },
      (error, result) => {
        if (error) reject(error);
        else resolve(result);
      },
    );
  });
}

export async function createAccount(username: string, password: string): Promise<Account> {
  const salt = randomBytes(16).toString('hex');

  return {
    username,
    salt,
    hash: (await hashPassword(password, salt)).toString('hex'),
  };
}

export async function matchesPassword(
  account: Account,
  username: string,
  password: string,
): Promise<boolean> {
  const supplied = await hashPassword(password, account.salt);

  return (
    timingSafeEqual(Buffer.from(account.hash, 'hex'), supplied) && username === account.username
  );
}

export function sessionHash(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}
