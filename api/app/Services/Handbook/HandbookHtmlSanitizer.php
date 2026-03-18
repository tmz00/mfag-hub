<?php

namespace App\Services\Handbook;

use DOMDocument;
use DOMElement;
use DOMNode;

class HandbookHtmlSanitizer
{
    /**
     * @var array<string, true>
     */
    private array $allowedIframeHosts = [
        'player.vimeo.com' => true,
        'www.youtube.com' => true,
        'www.youtube-nocookie.com' => true,
        'youtube.com' => true,
        'youtube-nocookie.com' => true,
    ];

    /**
     * @var array<string, true>
     */
    private array $allowedTags = [
        'a' => true,
        'b' => true,
        'blockquote' => true,
        'br' => true,
        'code' => true,
        'details' => true,
        'div' => true,
        'em' => true,
        'h1' => true,
        'h2' => true,
        'h3' => true,
        'h4' => true,
        'h5' => true,
        'h6' => true,
        'hr' => true,
        'i' => true,
        'iframe' => true,
        'img' => true,
        'li' => true,
        'ol' => true,
        'p' => true,
        'pre' => true,
        's' => true,
        'source' => true,
        'span' => true,
        'strong' => true,
        'sub' => true,
        'summary' => true,
        'sup' => true,
        'table' => true,
        'tbody' => true,
        'td' => true,
        'th' => true,
        'thead' => true,
        'tr' => true,
        'u' => true,
        'ul' => true,
        'video' => true,
    ];

    /**
     * @var array<string, true>
     */
    private array $blockedTags = [
        'button' => true,
        'embed' => true,
        'form' => true,
        'input' => true,
        'link' => true,
        'meta' => true,
        'object' => true,
        'script' => true,
        'select' => true,
        'style' => true,
        'textarea' => true,
    ];

    public function sanitize(string $html): string
    {
        $normalized = trim($html);
        if ($normalized === '') {
            return '';
        }

        $dom = new DOMDocument('1.0', 'UTF-8');
        $previous = libxml_use_internal_errors(true);
        $dom->loadHTML(
            '<?xml encoding="utf-8" ?><div id="handbook-root">' . $normalized . '</div>',
            LIBXML_HTML_NODEFDTD | LIBXML_HTML_NOIMPLIED
        );
        libxml_clear_errors();
        libxml_use_internal_errors($previous);

        $root = $dom->getElementById('handbook-root');
        if (!$root instanceof DOMElement) {
            return '';
        }

        foreach ($this->childNodes($root) as $child) {
            $this->sanitizeNode($child);
        }

        return $this->innerHtml($root);
    }

    private function sanitizeNode(DOMNode $node): void
    {
        foreach ($this->childNodes($node) as $child) {
            $this->sanitizeNode($child);
        }

        if ($node->nodeType === XML_COMMENT_NODE) {
            $node->parentNode?->removeChild($node);
            return;
        }

        if (!$node instanceof DOMElement) {
            return;
        }

        $tag = strtolower($node->tagName);
        if (isset($this->blockedTags[$tag])) {
            $node->parentNode?->removeChild($node);
            return;
        }

        if (!isset($this->allowedTags[$tag])) {
            $this->unwrapElement($node);
            return;
        }

        $this->sanitizeAttributes($node, $tag);
    }

    private function sanitizeAttributes(DOMElement $element, string $tag): void
    {
        $attributes = [];
        foreach ($this->attributeMap($element) as $name => $value) {
            $attributes[$name] = $value;
        }

        while ($element->attributes !== null && $element->attributes->length > 0) {
            $attribute = $element->attributes->item(0);
            if ($attribute === null) {
                break;
            }
            $element->removeAttributeNode($attribute);
        }

        $className = $this->sanitizeClassList($attributes['class'] ?? '');
        if ($className !== '') {
            $element->setAttribute('class', $className);
        }

        if ($tag === 'a') {
            $href = $this->sanitizeUrl($attributes['href'] ?? '', false, false);
            if ($href !== null) {
                $element->setAttribute('href', $href);
            }

            $target = strtolower(trim((string) ($attributes['target'] ?? '')));
            if ($target === '_blank') {
                $element->setAttribute('target', '_blank');
                $element->setAttribute('rel', 'noopener noreferrer');
            }

            $title = $this->truncateText($attributes['title'] ?? '', 255);
            if ($title !== '') {
                $element->setAttribute('title', $title);
            }

            return;
        }

        if ($tag === 'img') {
            $src = $this->sanitizeUrl($attributes['src'] ?? '', true, false);
            if ($src !== null) {
                $element->setAttribute('src', $src);
            } else {
                $element->parentNode?->removeChild($element);
                return;
            }

            $this->copyBoundedTextAttribute($element, 'alt', $attributes, 255);
            $this->copyBoundedTextAttribute($element, 'title', $attributes, 255);
            $this->copyNumericAttribute($element, 'width', $attributes, 1, 4096);
            $this->copyNumericAttribute($element, 'height', $attributes, 1, 4096);
            return;
        }

        if ($tag === 'video') {
            $src = $this->sanitizeUrl($attributes['src'] ?? '', false, false);
            if ($src !== null) {
                $element->setAttribute('src', $src);
            }
            $poster = $this->sanitizeUrl($attributes['poster'] ?? '', true, false);
            if ($poster !== null) {
                $element->setAttribute('poster', $poster);
            }
            foreach (['controls', 'playsinline', 'muted', 'loop', 'autoplay'] as $name) {
                if (array_key_exists($name, $attributes)) {
                    $element->setAttribute($name, $name);
                }
            }
            return;
        }

        if ($tag === 'source') {
            $src = $this->sanitizeUrl($attributes['src'] ?? '', false, false);
            if ($src !== null) {
                $element->setAttribute('src', $src);
            } else {
                $element->parentNode?->removeChild($element);
                return;
            }

            $type = $this->truncateText($attributes['type'] ?? '', 120);
            if ($type !== '') {
                $element->setAttribute('type', $type);
            }
            return;
        }

        if ($tag === 'iframe') {
            $src = $this->sanitizeUrl($attributes['src'] ?? '', false, true);
            if ($src === null) {
                $element->parentNode?->removeChild($element);
                return;
            }

            $element->setAttribute('src', $src);
            $element->setAttribute('frameborder', '0');
            $element->setAttribute('allowfullscreen', 'allowfullscreen');
            $this->copyBoundedTextAttribute($element, 'allow', $attributes, 255);
            $this->copyNumericAttribute($element, 'width', $attributes, 1, 4096);
            $this->copyNumericAttribute($element, 'height', $attributes, 1, 4096);
            return;
        }

        if ($tag === 'details') {
            if (array_key_exists('open', $attributes)) {
                $element->setAttribute('open', 'open');
            }
            return;
        }

        if (in_array($tag, ['td', 'th'], true)) {
            $this->copyNumericAttribute($element, 'colspan', $attributes, 1, 24);
            $this->copyNumericAttribute($element, 'rowspan', $attributes, 1, 24);
            if ($tag === 'th') {
                $scope = strtolower(trim((string) ($attributes['scope'] ?? '')));
                if (in_array($scope, ['col', 'row', 'colgroup', 'rowgroup'], true)) {
                    $element->setAttribute('scope', $scope);
                }
            }
        }
    }

    private function sanitizeUrl(string $value, bool $allowDataImage, bool $iframeOnly): ?string
    {
        $trimmed = trim(html_entity_decode($value, ENT_QUOTES | ENT_HTML5, 'UTF-8'));
        if ($trimmed === '') {
            return null;
        }

        $lower = strtolower($trimmed);
        if ($allowDataImage && preg_match('/^data:image\\//i', $trimmed) === 1) {
            return $trimmed;
        }

        if (!$iframeOnly && (
            str_starts_with($trimmed, '#')
            || str_starts_with($trimmed, '/')
            || str_starts_with($trimmed, './')
            || str_starts_with($trimmed, '../')
        )) {
            return $trimmed;
        }

        $scheme = strtolower((string) parse_url($trimmed, PHP_URL_SCHEME));
        if ($scheme === '') {
            if ($iframeOnly) {
                return null;
            }

            return str_contains($lower, 'javascript:') ? null : $trimmed;
        }

        if ($iframeOnly) {
            return $this->sanitizeIframeUrl($trimmed, $scheme);
        }

        return in_array($scheme, ['http', 'https', 'mailto', 'tel'], true) ? $trimmed : null;
    }

    private function sanitizeIframeUrl(string $value, string $scheme): ?string
    {
        if ($scheme !== 'https') {
            return null;
        }

        $host = strtolower((string) parse_url($value, PHP_URL_HOST));
        if (!isset($this->allowedIframeHosts[$host])) {
            return null;
        }

        $path = strtolower((string) parse_url($value, PHP_URL_PATH));
        if (in_array($host, ['www.youtube.com', 'www.youtube-nocookie.com', 'youtube.com', 'youtube-nocookie.com'], true)) {
            return str_starts_with($path, '/embed/') ? $value : null;
        }

        if ($host === 'player.vimeo.com') {
            return str_starts_with($path, '/video/') ? $value : null;
        }

        return null;
    }

    private function sanitizeClassList(string $value): string
    {
        $classes = preg_split('/\s+/', trim($value)) ?: [];
        $allowed = [];
        foreach ($classes as $className) {
            $trimmed = trim($className);
            if ($trimmed === '') {
                continue;
            }

            if ($trimmed === 'is-collapsed' || preg_match('/^ql-[a-z0-9-]+$/i', $trimmed) === 1) {
                $allowed[] = $trimmed;
            }
        }

        return implode(' ', array_values(array_unique($allowed)));
    }

    /**
     * @return array<int, DOMNode>
     */
    private function childNodes(DOMNode $node): array
    {
        $children = [];
        foreach ($node->childNodes as $child) {
            $children[] = $child;
        }

        return $children;
    }

    /**
     * @return array<string, string>
     */
    private function attributeMap(DOMElement $element): array
    {
        $attributes = [];
        foreach ($element->attributes as $attribute) {
            $attributes[strtolower($attribute->nodeName)] = $attribute->nodeValue ?? '';
        }

        return $attributes;
    }

    private function unwrapElement(DOMElement $element): void
    {
        $parent = $element->parentNode;
        if ($parent === null) {
            return;
        }

        while ($element->firstChild !== null) {
            $parent->insertBefore($element->firstChild, $element);
        }

        $parent->removeChild($element);
    }

    private function innerHtml(DOMElement $element): string
    {
        $html = '';
        foreach ($element->childNodes as $child) {
            $html .= $element->ownerDocument?->saveHTML($child) ?? '';
        }

        return $html;
    }

    /**
     * @param array<string, string> $attributes
     */
    private function copyBoundedTextAttribute(
        DOMElement $element,
        string $name,
        array $attributes,
        int $maxLength
    ): void {
        $value = $this->truncateText($attributes[$name] ?? '', $maxLength);
        if ($value !== '') {
            $element->setAttribute($name, $value);
        }
    }

    /**
     * @param array<string, string> $attributes
     */
    private function copyNumericAttribute(
        DOMElement $element,
        string $name,
        array $attributes,
        int $min,
        int $max
    ): void {
        $raw = trim((string) ($attributes[$name] ?? ''));
        if ($raw === '' || preg_match('/^\d+$/', $raw) !== 1) {
            return;
        }

        $value = (int) $raw;
        if ($value < $min || $value > $max) {
            return;
        }

        $element->setAttribute($name, (string) $value);
    }

    private function truncateText(string $value, int $maxLength): string
    {
        return trim(substr($value, 0, $maxLength));
    }
}
