/**
 * Output Truncation Utilities
 * Prevents overwhelming AI with massive outputs
 */

export interface TruncatedOutput {
  truncated: boolean;
  data: string;
  totalSize?: number;
  truncatedSize?: number;
  message?: string;
  suggestion?: string;
}

/**
 * Truncates output intelligently with metadata
 * @param data The data to potentially truncate
 * @param maxSize Maximum size in characters (default: 50000)
 * @param context Context hint for better suggestions
 */
export function truncateOutput(
  data: string, 
  maxSize: number = 50000,
  context?: 'html' | 'json' | 'text' | 'network'
): TruncatedOutput {
  if (data.length <= maxSize) {
    return { truncated: false, data };
  }
  
  // Context-specific suggestions
  const suggestions: Record<string, string> = {
    html: 'Use get_html with specific selector (e.g., get_html({selector: ".main-content"})) to get smaller chunks. Or use execute_script with targeted querySelector.',
    json: 'Use execute_script to filter/query the data before returning. Example: return data.filter(item => item.id < 10)',
    network: 'Use more specific URL patterns in interception. Or filter by resourceType (XHR, Fetch only).',
    text: 'Use more specific selectors or queries to extract only the needed portion.'
  };
  
  const suggestion = context ? suggestions[context] : 'Use more specific filters or selectors to reduce output size.';
  
  return {
    truncated: true,
    totalSize: data.length,
    truncatedSize: maxSize,
    data: data.substring(0, maxSize),
    message: `⚠️ Output truncated: ${data.length} chars → ${maxSize} chars (${Math.round((maxSize/data.length)*100)}% shown)`,
    suggestion
  };
}

/**
 * Truncates array outputs intelligently
 */
export function truncateArray<T>(
  items: T[], 
  maxItems: number = 100,
  context?: string
): { truncated: boolean; items: T[]; totalCount?: number; message?: string } {
  if (items.length <= maxItems) {
    return { truncated: false, items };
  }
  
  return {
    truncated: true,
    totalCount: items.length,
    items: items.slice(0, maxItems),
    message: `⚠️ Array truncated: ${items.length} items → ${maxItems} items shown. ${context || 'Use more specific filters to see remaining items.'}`
  };
}
