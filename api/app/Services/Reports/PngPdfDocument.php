<?php

namespace App\Services\Reports;

use InvalidArgumentException;

class PngPdfDocument
{
    /**
     * @return array{width: int, height: int, bitDepth: int, colorType: int, idat: string}
     */
    private function parsePng(string $pngData): array
    {
        $signature = "\x89PNG\r\n\x1a\n";
        if (!str_starts_with($pngData, $signature)) {
            throw new InvalidArgumentException('Invalid PNG signature.');
        }

        $offset = 8;
        $length = strlen($pngData);
        $width = 0;
        $height = 0;
        $bitDepth = 0;
        $colorType = 0;
        $idat = '';

        while ($offset + 8 <= $length) {
            $chunkLength = unpack('N', substr($pngData, $offset, 4))[1] ?? 0;
            $chunkType = substr($pngData, $offset + 4, 4);
            $chunkDataOffset = $offset + 8;
            $chunkDataEnd = $chunkDataOffset + $chunkLength;
            $crcEnd = $chunkDataEnd + 4;

            if ($chunkDataEnd > $length || $crcEnd > $length) {
                throw new InvalidArgumentException('Corrupt PNG chunk boundaries.');
            }

            $chunkData = substr($pngData, $chunkDataOffset, $chunkLength);

            if ($chunkType === 'IHDR') {
                $width = unpack('N', substr($chunkData, 0, 4))[1] ?? 0;
                $height = unpack('N', substr($chunkData, 4, 4))[1] ?? 0;
                $bitDepth = ord($chunkData[8] ?? "\x00");
                $colorType = ord($chunkData[9] ?? "\x00");
            } elseif ($chunkType === 'IDAT') {
                $idat .= $chunkData;
            } elseif ($chunkType === 'IEND') {
                break;
            }

            $offset = $crcEnd;
        }

        if ($width <= 0 || $height <= 0 || $idat === '') {
            throw new InvalidArgumentException('PNG is missing required image data.');
        }

        // This renderer always writes truecolor PNG without alpha.
        if ($bitDepth !== 8 || $colorType !== 2) {
            throw new InvalidArgumentException('Only 8-bit RGB PNG images are supported.');
        }

        return [
            'width' => $width,
            'height' => $height,
            'bitDepth' => $bitDepth,
            'colorType' => $colorType,
            'idat' => $idat,
        ];
    }

    private function formatNumber(float $value): string
    {
        $rounded = round($value, 4);
        $formatted = rtrim(rtrim(sprintf('%.4F', $rounded), '0'), '.');
        return $formatted === '' ? '0' : $formatted;
    }

    public function buildFromPng(
        string $pngData,
        float $pageWidth,
        float $pageHeight
    ): string {
        $parsed = $this->parsePng($pngData);
        $imageWidth = (int) $parsed['width'];
        $imageHeight = (int) $parsed['height'];
        $idat = $parsed['idat'];

        $safePageWidth = max(1.0, $pageWidth);
        $safePageHeight = max(1.0, $pageHeight);
        $contentStream = implode("\n", [
            'q',
            $this->formatNumber($safePageWidth) . ' 0 0 ' . $this->formatNumber($safePageHeight) . ' 0 0 cm',
            '/Im0 Do',
            'Q',
        ]);

        $objects = [];
        $objects[1] = '<< /Type /Catalog /Pages 2 0 R >>';
        $objects[2] = '<< /Type /Pages /Kids [3 0 R] /Count 1 >>';
        $objects[3] = '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ' .
            $this->formatNumber($safePageWidth) . ' ' . $this->formatNumber($safePageHeight) .
            '] /Resources << /XObject << /Im0 5 0 R >> >> /Contents 4 0 R >>';
        $objects[4] = '<< /Length ' . strlen($contentStream) . " >>\nstream\n" .
            $contentStream . "\nendstream";
        $objects[5] = '<< /Type /XObject /Subtype /Image /Width ' . $imageWidth .
            ' /Height ' . $imageHeight .
            ' /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /FlateDecode ' .
            '/DecodeParms << /Predictor 15 /Colors 3 /BitsPerComponent 8 /Columns ' . $imageWidth .
            ' >> /Length ' . strlen($idat) . " >>\nstream\n" .
            $idat . "\nendstream";

        $pdf = "%PDF-1.4\n%\xE2\xE3\xCF\xD3\n";
        $offsets = [];
        $count = count($objects);

        for ($i = 1; $i <= $count; $i++) {
            $offsets[$i] = strlen($pdf);
            $pdf .= $i . " 0 obj\n" . $objects[$i] . "\nendobj\n";
        }

        $xrefOffset = strlen($pdf);
        $pdf .= 'xref' . "\n";
        $pdf .= '0 ' . ($count + 1) . "\n";
        $pdf .= "0000000000 65535 f \n";
        for ($i = 1; $i <= $count; $i++) {
            $pdf .= sprintf('%010d 00000 n ', (int) $offsets[$i]) . "\n";
        }
        $pdf .= 'trailer' . "\n";
        $pdf .= '<< /Size ' . ($count + 1) . ' /Root 1 0 R >>' . "\n";
        $pdf .= 'startxref' . "\n";
        $pdf .= $xrefOffset . "\n";
        $pdf .= '%%EOF';

        return $pdf;
    }
}
