import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm';

@Entity('users')
export class User {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ unique: true })
  email: string;

  @Column()
  passwordHash: string;

  @Column({ type: 'varchar', nullable: true })
  refreshTokenHash: string | null;

  @Column({ type: 'varchar', nullable: true })
  refreshSessionId: string | null;

  @Column({ default: 'user' })
  role: 'user' | 'admin';
}
