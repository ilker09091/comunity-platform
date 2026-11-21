import { MigrationInterface, QueryRunner } from 'typeorm';

/** The games this migration shipped with; see MoreChatGames for the current list. */
const GAME_KINDS = ['xox', 'connect4', 'rps'] as const;

/**
 * Personal touches per conversation (a private nickname and a wallpaper only you see) and
 * turn-based mini games played inside a chat. A game lives in a message, like a sticker.
 */
export class ChatPrefsAndGames1760192900000 implements MigrationInterface {
  name = 'ChatPrefsAndGames1760192900000';
  async up(q: QueryRunner) {
    await q.query(`CREATE TABLE conversation_prefs (
      user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      peer_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      nickname varchar(40) CHECK (nickname IS NULL OR char_length(btrim(nickname)) BETWEEN 1 AND 40),
      wallpaper_media_id uuid REFERENCES media(id) ON DELETE SET NULL,
      updated_at timestamptz NOT NULL DEFAULT now(),
      PRIMARY KEY (user_id, peer_id),
      CHECK (user_id <> peer_id))`);
    await q.query('CREATE INDEX conversation_prefs_wallpaper ON conversation_prefs(wallpaper_media_id) WHERE wallpaper_media_id IS NOT NULL');
    await q.query(`CREATE TABLE chat_games (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      low_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      high_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      kind varchar(16) NOT NULL CHECK (kind IN (${GAME_KINDS.map((k) => `'${k}'`).join(',')})),
      players uuid[] NOT NULL CHECK (array_length(players, 1) = 2),
      state jsonb NOT NULL CHECK (jsonb_typeof(state) = 'object'),
      turn_id uuid,
      status varchar(8) NOT NULL DEFAULT 'active' CHECK (status IN ('active','won','draw')),
      winner_id uuid,
      created_by uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now(),
      CHECK (low_id < high_id))`);
    await q.query('CREATE INDEX chat_games_pair ON chat_games(low_id, high_id, created_at DESC)');
    await q.query('ALTER TABLE direct_messages ADD COLUMN game_id uuid REFERENCES chat_games(id) ON DELETE SET NULL');
    await q.query('CREATE INDEX direct_messages_game ON direct_messages(game_id) WHERE game_id IS NOT NULL');
  }
  async down(q: QueryRunner) {
    await q.query('ALTER TABLE direct_messages DROP COLUMN game_id');
    await q.query('DROP TABLE chat_games');
    await q.query('DROP TABLE conversation_prefs');
  }
}
