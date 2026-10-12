import { Column, CreateDateColumn, Entity, PrimaryColumn, PrimaryGeneratedColumn } from 'typeorm';

// Entities map the tables created by the SQL migrations. Relations are expressed as plain
// FK columns (no decorators) to avoid ESM circular-import issues; joins are done in SQL.
// The schema is owned by migrations — `synchronize` is always disabled.

export type UserStatus = 'ACTIVE' | 'SUSPENDED' | 'BANNED' | 'DEACTIVATED';
export type Role = 'USER' | 'SUPPORT' | 'MODERATOR' | 'ADMIN' | 'SUPER_ADMIN';
export type MediaType = 'IMAGE' | 'VIDEO';
export type MediaStatus = 'PROCESSING' | 'READY' | 'FAILED';
export type ReportTargetType = 'POST' | 'COMMENT' | 'USER';
export type ReportStatus = 'OPEN' | 'RESOLVED' | 'DISMISSED';

const timestamp = { type: 'timestamptz', precision: 3 } as const;

@Entity({ name: 'users' })
export class UserEntity {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column({ type: 'citext' }) username: string;
  @Column({ type: 'citext' }) email: string;
  @Column({ name: 'password_hash', type: 'text', select: false }) passwordHash: string;
  @Column({ name: 'display_name', type: 'varchar', length: 50 }) displayName: string;
  @Column({ type: 'varchar', length: 300, nullable: true }) bio: string | null;
  @Column({ type: 'varchar', length: 100, nullable: true }) location: string | null;
  @Column({ type: 'varchar', length: 200, nullable: true }) website: string | null;
  @Column({ name: 'avatar_media_id', type: 'uuid', nullable: true }) avatarMediaId: string | null;
  @Column({ name: 'cover_media_id', type: 'uuid', nullable: true }) coverMediaId: string | null;
  @Column({ name: 'is_private', type: 'boolean', default: false }) isPrivate: boolean;
  @Column({ name: 'is_verified', type: 'boolean', default: false }) isVerified: boolean;
  @Column({ type: 'enum', enum: ['ACTIVE', 'SUSPENDED', 'BANNED', 'DEACTIVATED'], enumName: 'user_status' }) status: UserStatus;
  @Column({ type: 'enum', enum: ['USER', 'SUPPORT', 'MODERATOR', 'ADMIN', 'SUPER_ADMIN'], enumName: 'user_role' }) role: Role;
  @Column({ name: 'follower_count', type: 'int' }) followerCount: number;
  @Column({ name: 'following_count', type: 'int' }) followingCount: number;
  @Column({ name: 'post_count', type: 'int' }) postCount: number;
  @Column({ name: 'password_changed_at', ...timestamp, nullable: true }) passwordChangedAt: Date | null;
  @CreateDateColumn({ name: 'created_at', ...timestamp }) createdAt: Date;
  @Column({ name: 'updated_at', ...timestamp }) updatedAt: Date;
}

@Entity({ name: 'sessions' })
export class SessionEntity {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column({ name: 'user_id', type: 'uuid' }) userId: string;
  @Column({ name: 'user_agent', type: 'varchar', length: 255, nullable: true }) userAgent: string | null;
  @Column({ name: 'ip_address', type: 'varchar', length: 64, nullable: true }) ipAddress: string | null;
  @CreateDateColumn({ name: 'created_at', ...timestamp }) createdAt: Date;
  @Column({ name: 'last_used_at', ...timestamp }) lastUsedAt: Date;
  @Column({ name: 'expires_at', ...timestamp }) expiresAt: Date;
  @Column({ name: 'revoked_at', ...timestamp, nullable: true }) revokedAt: Date | null;
  @Column({ name: 'revoked_reason', type: 'varchar', length: 50, nullable: true }) revokedReason: string | null;
}

@Entity({ name: 'refresh_tokens' })
export class RefreshTokenEntity {
  @PrimaryColumn('uuid') id: string;
  @Column({ name: 'session_id', type: 'uuid' }) sessionId: string;
  @Column({ name: 'token_hash', type: 'char', length: 64 }) tokenHash: string;
  @Column({ name: 'expires_at', ...timestamp }) expiresAt: Date;
  @Column({ name: 'used_at', ...timestamp, nullable: true }) usedAt: Date | null;
  @CreateDateColumn({ name: 'created_at', ...timestamp }) createdAt: Date;
}

@Entity({ name: 'media' })
export class MediaEntity {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column({ name: 'owner_id', type: 'uuid' }) ownerId: string;
  @Column({ type: 'enum', enum: ['IMAGE', 'VIDEO'], enumName: 'media_type' }) type: MediaType;
  @Column({ type: 'enum', enum: ['PROCESSING', 'READY', 'FAILED'], enumName: 'media_status' }) status: MediaStatus;
  @Column({ name: 'storage_key', type: 'varchar', length: 255 }) storageKey: string;
  @Column({ name: 'mime_type', type: 'varchar', length: 100 }) mimeType: string;
  @Column({ name: 'size_bytes', type: 'bigint' }) sizeBytes: string;
  @Column({ type: 'int', nullable: true }) width: number | null;
  @Column({ type: 'int', nullable: true }) height: number | null;
  @Column({ name: 'duration_ms', type: 'int', nullable: true }) durationMs: number | null;
  @CreateDateColumn({ name: 'created_at', ...timestamp }) createdAt: Date;
}

@Entity({ name: 'reports' })
export class ReportEntity {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column({ name: 'reporter_id', type: 'uuid' }) reporterId: string;
  @Column({ name: 'target_type', type: 'enum', enum: ['POST', 'COMMENT', 'USER'], enumName: 'report_target_type' })
  targetType: ReportTargetType;
  @Column({ name: 'target_id', type: 'uuid' }) targetId: string;
  @Column({ type: 'varchar' }) reason: string;
  @Column({ type: 'varchar', length: 1000, nullable: true }) details: string | null;
  @Column({ type: 'enum', enum: ['OPEN', 'RESOLVED', 'DISMISSED'], enumName: 'report_status' }) status: ReportStatus;
  @Column({ name: 'resolution_note', type: 'varchar', length: 1000, nullable: true }) resolutionNote: string | null;
  @Column({ name: 'resolved_by_id', type: 'uuid', nullable: true }) resolvedById: string | null;
  @Column({ name: 'resolved_at', ...timestamp, nullable: true }) resolvedAt: Date | null;
  @CreateDateColumn({ name: 'created_at', ...timestamp }) createdAt: Date;
  @Column({ name: 'updated_at', ...timestamp }) updatedAt: Date;
}

export const entities = [UserEntity, SessionEntity, RefreshTokenEntity, MediaEntity, ReportEntity];
