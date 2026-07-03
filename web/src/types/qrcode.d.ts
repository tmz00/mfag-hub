declare module "qrcode" {
  type ToDataUrlOptions = {
    width?: number;
    margin?: number;
    errorCorrectionLevel?: "L" | "M" | "Q" | "H";
    color?: {
      dark?: string;
      light?: string;
    };
  };

  export function toDataURL(
    text: string,
    options?: ToDataUrlOptions,
  ): Promise<string>;
}
