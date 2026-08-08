-- Create referrals, referral claims, and credits tables
CREATE TABLE IF NOT EXISTS wai_referrals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text UNIQUE NOT NULL,
  referrer_id uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at timestamptz DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS wai_referral_claims (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  referral_id uuid REFERENCES wai_referrals(id) ON DELETE CASCADE,
  claimant_id uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at timestamptz DEFAULT NOW(),
  UNIQUE (referral_id, claimant_id)
);

CREATE TABLE IF NOT EXISTS wai_credits (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  credits integer DEFAULT 0 NOT NULL,
  updated_at timestamptz DEFAULT NOW()
);

-- index for fast lookup by code
CREATE INDEX IF NOT EXISTS idx_wai_referrals_code ON wai_referrals(code);
