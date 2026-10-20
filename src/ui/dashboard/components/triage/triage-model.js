export const triageFields = ['intent', 'sentiment', 'language'];
export const fieldName = value => value.charAt(0).toUpperCase() + value.slice(1);
export const intentName = (value, taxonomy) => taxonomy.find(row => row.id === value)?.name || value;
export const triageValue = (field, value, taxonomy) => value ? field === 'intent' ? intentName(value, taxonomy) : value : 'Not classified';
export const confidence = value => `${(value * 100).toFixed(1)}%`;
