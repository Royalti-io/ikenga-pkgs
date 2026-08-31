export interface ChallengeDetectionResult {
  hasChallenge: boolean;
  type?: '2fa_prompt' | 'captcha' | 'password_reauth' | 'account_disabled' | 'unknown';
  message?: string;
}

/**
 * Inspects a Google page URL and DOM text to detect authentication challenges.
 */
export function detectGoogleChallenge(url: string, pageText: string): ChallengeDetectionResult {
  const lowerUrl = url.toLowerCase();
  const lowerText = pageText.toLowerCase();

  if (lowerUrl.includes('/signin/v2/challenge') || lowerUrl.includes('/signin/challenge')) {
    if (lowerText.includes('2-step verification') || lowerText.includes('check your phone') || lowerText.includes('authenticator')) {
      return {
        hasChallenge: true,
        type: '2fa_prompt',
        message: 'Google 2-Step Verification required. Please complete 2FA on your authenticator device.',
      };
    }

    if (lowerText.includes('captcha') || lowerText.includes('type the characters you see')) {
      return {
        hasChallenge: true,
        type: 'captcha',
        message: 'Google CAPTCHA challenge detected. Interactive resolution required.',
      };
    }

    if (lowerText.includes('enter your password') || lowerText.includes('wrong password')) {
      return {
        hasChallenge: true,
        type: 'password_reauth',
        message: 'Google session password re-authentication required.',
      };
    }

    return {
      hasChallenge: true,
      type: 'unknown',
      message: 'Google security challenge encountered.',
    };
  }

  if (lowerText.includes('your account has been disabled') || lowerUrl.includes('disabled')) {
    return {
      hasChallenge: true,
      type: 'account_disabled',
      message: 'Google account appears disabled or restricted.',
    };
  }

  return {
    hasChallenge: false,
  };
}
