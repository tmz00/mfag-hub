/**
 * Simple validation utilities
 */

export const required = (value: string): string => {
  return value.trim() ? "" : "This field is required";
};

export const email = (value: string): string => {
  if (!value.trim()) return "Email is required";
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(value) ? "" : "Please enter a valid email address";
};

export const minLength = (min: number) => (value: string): string => {
  if (!value.trim()) return "This field is required";
  return value.length >= min ? "" : `Must be at least ${min} characters`;
};

export const maxLength = (max: number) => (value: string): string => {
  return value.length <= max ? "" : `Must be at most ${max} characters`;
};

/**
 * Compose multiple validators
 */
export const validate = (...validators: Array<(value: any) => string>) => {
  return (value: any): string => {
    for (const validator of validators) {
      const error = validator(value);
      if (error) return error;
    }
    return "";
  };
};
