<?php

namespace App\Services\Handbook;

use App\Models\HandbookCategory;
use DOMDocument;
use DOMElement;
use DOMNode;
use DOMText;
use Illuminate\Support\Str;

class HandbookSearchService
{
    /**
     * @return array<int, array<string, mixed>>
     */
    public function search(string $term, int $limit = 20): array
    {
        $normalizedTerm = $this->normalizeText($term);
        if ($normalizedTerm === '' || $limit <= 0) {
            return [];
        }

        $categories = HandbookCategory::query()
            ->orderBy('position')
            ->orderBy('id')
            ->get(['id', 'category', 'content']);

        $results = [];

        foreach ($categories as $categoryRow) {
            $categoryName = trim((string) ($categoryRow->category ?? ''));
            $displayCategory = $categoryName !== '' ? $categoryName : 'Untitled category';
            $categoryMatch = Str::contains(Str::lower($displayCategory), Str::lower($normalizedTerm));

            $lines = $this->extractContentLines((string) ($categoryRow->content ?? ''));
            $matched = false;

            foreach ($lines as $index => $line) {
                $text = (string) ($line['text'] ?? '');
                if (!Str::contains(Str::lower($text), Str::lower($normalizedTerm))) {
                    continue;
                }

                $matched = true;
                $targetKind = 'line';
                $matchedSnippet = $this->createMatchSnippet($text, $normalizedTerm);
                $nextLine = (string) ($lines[$index + 1]['text'] ?? '');
                $previousLine = (string) ($lines[$index - 1]['text'] ?? '');
                $contextLine = $nextLine !== '' ? $nextLine : $previousLine;

                $snippetLines = array_values(array_filter([
                    $matchedSnippet,
                    $contextLine !== '' ? $this->createContextSnippet($contextLine) : '',
                ]));

                if (($line['kind'] ?? '') === 'h2') {
                    $targetKind = 'section';
                    $snippetLines = [];
                }

                if (($line['isSection'] ?? false) === true) {
                    $targetKind = 'section';
                    $afterLines = array_values(array_filter(array_map(
                        fn (array $item): string => ($item['isSection'] ?? false) === true
                            ? ''
                            : $this->createContextSnippet((string) ($item['text'] ?? '')),
                        array_slice($lines, $index + 1)
                    )));
                    $snippetLines = array_slice($afterLines, 0, 2);
                }

                $results[] = [
                    'categoryId' => (int) $categoryRow->id,
                    'category' => $displayCategory,
                    'h2' => (string) ($line['h2'] ?? ''),
                    'section' => (string) ($line['section'] ?? ''),
                    'lines' => $snippetLines,
                    'targetText' => $targetKind === 'line'
                        ? $matchedSnippet
                        : (string) ($line['text'] ?? ''),
                    'targetKind' => $targetKind,
                ];

                if (count($results) >= $limit) {
                    return $results;
                }
            }

            if (!$matched && $categoryMatch) {
                $results[] = [
                    'categoryId' => (int) $categoryRow->id,
                    'category' => $displayCategory,
                    'h2' => '',
                    'section' => '',
                    'lines' => [],
                    'targetText' => $displayCategory,
                    'targetKind' => 'category',
                ];

                if (count($results) >= $limit) {
                    return $results;
                }
            }
        }

        return $results;
    }

    /**
     * @return array<int, array<string, mixed>>
     */
    private function extractContentLines(string $html): array
    {
        $normalizedHtml = trim($html);
        if ($normalizedHtml === '') {
            return [];
        }

        $dom = new DOMDocument('1.0', 'UTF-8');
        $previous = libxml_use_internal_errors(true);
        $dom->loadHTML('<?xml encoding="utf-8" ?>' . $normalizedHtml, LIBXML_HTML_NODEFDTD | LIBXML_HTML_NOIMPLIED);
        libxml_clear_errors();
        libxml_use_internal_errors($previous);

        $lines = [];
        $state = [
            'section' => '',
            'h1' => '',
            'h2' => '',
        ];

        foreach ($dom->childNodes as $child) {
            $this->walkNode($child, $state, $lines);
        }

        return $lines;
    }

    /**
     * @param array<string, string> $state
     * @param array<int, array<string, mixed>> $lines
     */
    private function walkNode(DOMNode $node, array &$state, array &$lines): void
    {
        if ($node instanceof DOMElement) {
            $tag = strtolower($node->tagName);

            if ($tag === 'summary') {
                $state['section'] = $this->normalizeText((string) $node->textContent);
                if ($state['section'] !== '') {
                    $this->pushLine($lines, $state, $state['section'], true, 'section');
                }
                return;
            }

            if ($tag === 'h1') {
                $state['h1'] = $this->normalizeText((string) $node->textContent);
                $state['h2'] = '';
                if ($state['h1'] !== '') {
                    $this->pushLine($lines, $state, $state['h1']);
                }
                return;
            }

            if ($tag === 'h2') {
                $state['h2'] = $this->normalizeText((string) $node->textContent);
                if ($state['h2'] !== '') {
                    $this->pushLine($lines, $state, $state['h2'], false, 'h2');
                }
                return;
            }

            if (in_array($tag, ['p', 'li', 'h1', 'h3', 'h4', 'h5', 'h6', 'blockquote', 'td', 'th'], true)) {
                $this->pushLine($lines, $state, (string) $node->textContent);
                return;
            }

            foreach ($node->childNodes as $child) {
                $this->walkNode($child, $state, $lines);
            }
            return;
        }

        if ($node instanceof DOMText) {
            $this->pushLine($lines, $state, (string) $node->textContent);
        }
    }

    /**
     * @param array<int, array<string, mixed>> $lines
     * @param array<string, string> $state
     */
    private function pushLine(
        array &$lines,
        array $state,
        string $text,
        bool $isSection = false,
        string $kind = 'line'
    ): void {
        $cleaned = $this->normalizeText($text);
        if ($cleaned === '') {
            return;
        }

        $lines[] = [
            'section' => $state['section'],
            'h2' => $state['h2'] !== '' ? $state['h2'] : $state['h1'],
            'text' => $cleaned,
            'kind' => $kind,
            'isSection' => $isSection,
        ];
    }

    private function createContextSnippet(string $text, int $maxLength = 140): string
    {
        $sentences = $this->splitSentences($text);
        if ($sentences === []) {
            return '';
        }

        $snippet = '';
        foreach ($sentences as $sentence) {
            $candidate = $snippet === '' ? $sentence : $snippet . ' ' . $sentence;
            if ($snippet !== '' && mb_strlen($candidate) > $maxLength) {
                break;
            }
            $snippet = $candidate;
            if (mb_strlen($snippet) >= $maxLength) {
                break;
            }
        }

        if ($snippet === '') {
            $snippet = $sentences[0];
        }

        $normalizedText = $this->normalizeText($text);
        if (count($sentences) > 1 && mb_strlen($snippet) < mb_strlen($normalizedText)) {
            return $snippet . '...';
        }

        return $snippet;
    }

    private function createMatchSnippet(string $text, string $term, int $maxLength = 180): string
    {
        $cleaned = $this->normalizeText($text);
        if ($cleaned === '') {
            return $cleaned;
        }

        $normalizedTerm = Str::lower($this->normalizeText($term));
        if ($normalizedTerm === '') {
            return $this->createContextSnippet($cleaned, $maxLength);
        }

        $sentences = $this->splitSentences($cleaned);
        if ($sentences === []) {
            return $cleaned;
        }

        $matchIndex = -1;
        foreach ($sentences as $index => $sentence) {
            if (Str::contains(Str::lower($sentence), $normalizedTerm)) {
                $matchIndex = $index;
                break;
            }
        }

        if ($matchIndex < 0) {
            return $this->createContextSnippet($cleaned, $maxLength);
        }

        $start = $matchIndex;
        $end = $matchIndex;
        $combined = $sentences[$matchIndex];

        while (mb_strlen($combined) < $maxLength) {
            $canAddPrev = $start > 0;
            $canAddNext = $end < count($sentences) - 1;
            if (!$canAddPrev && !$canAddNext) {
                break;
            }

            $prevCandidate = $canAddPrev ? $sentences[$start - 1] . ' ' . $combined : '';
            $nextCandidate = $canAddNext ? $combined . ' ' . $sentences[$end + 1] : '';

            $prevWithin = $canAddPrev && mb_strlen($prevCandidate) <= $maxLength;
            $nextWithin = $canAddNext && mb_strlen($nextCandidate) <= $maxLength;

            if (!$prevWithin && !$nextWithin) {
                break;
            }

            if ($prevWithin && (!$nextWithin || mb_strlen($prevCandidate) <= mb_strlen($nextCandidate))) {
                $start -= 1;
                $combined = $prevCandidate;
                continue;
            }

            $end += 1;
            $combined = $nextCandidate;
        }

        $prefix = $start > 0 ? '... ' : '';
        $suffix = $end < count($sentences) - 1 ? ' ...' : '';

        return $prefix . $combined . $suffix;
    }

    /**
     * @return array<int, string>
     */
    private function splitSentences(string $text): array
    {
        $normalized = $this->normalizeText($text);
        if ($normalized === '') {
            return [];
        }

        $matches = preg_match_all('/[^.!?]+[.!?]?/u', $normalized, $parts);
        if ($matches === false || $matches === 0) {
            return [$normalized];
        }

        return array_values(array_filter(array_map(
            fn (string $value): string => trim($value),
            $parts[0]
        )));
    }

    private function normalizeText(string $value): string
    {
        $collapsed = preg_replace('/\s+/u', ' ', $value);
        return trim((string) ($collapsed ?? ''));
    }
}
