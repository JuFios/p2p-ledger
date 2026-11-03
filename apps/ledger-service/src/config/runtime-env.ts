// CLI і bootstrap читають env без контейнера залежностей Nest.
export function readDatabaseEnvironment() {
  return {
    host: process.env.DATABASE_HOST,
    port: Number(process.env.DATABASE_PORT ?? 5432),
    username: process.env.DATABASE_USER,
    password: process.env.DATABASE_PASSWORD,
    database: process.env.DATABASE_NAME,
  };
}

export function readListenPort() {
  return process.env.PORT ?? 3001;
}
