# digital-conversion

[![npm version](https://img.shields.io/npm/v/digital-conversion.svg)](https://www.npmjs.com/package/digital-conversion)
[![npm license](https://img.shields.io/npm/l/digital-conversion.svg)](https://www.npmjs.com/package/digital-conversion)
[![node version](https://img.shields.io/node/v/digital-conversion.svg)](https://www.npmjs.com/package/digital-conversion)

一個零依賴的輕量字串與數字工具組，提供反轉字串、迴文判斷、字首大寫、千分位格式化、隨機整數與數值限制等功能。

- 零依賴、體積小（未壓縮約 4.4 kB）
- 同時支援 CommonJS 與 ES Modules
- 支援 Unicode（包含中文）
- 完整的參數驗證與單元測試

## 安裝

```bash
npm install digital-conversion
```

需求：Node.js 18 以上。

## 快速開始

### CommonJS

```js
const {
  reverseString,
  isPalindrome,
  capitalizeWords,
  formatThousands,
  randomInt,
  clamp,
} = require('digital-conversion');

reverseString('hello');                          // 'olleh'
isPalindrome('A man, a plan, a canal: Panama');  // true
capitalizeWords('hello world');                  // 'Hello World'
formatThousands(1234567);                        // '1,234,567'
randomInt(1, 6);                                 // 1 到 6 之間的整數（含頭尾）
clamp(42, 0, 10);                                // 10
```

### ES Modules

```js
import { reverseString, formatThousands } from 'digital-conversion';

reverseString('你好');      // '好你'
formatThousands(-9876543); // '-9,876,543'
```

## API

| 函式 | 說明 | 回傳 |
| --- | --- | --- |
| [`reverseString(text)`](#reversestringtext) | 反轉字串（支援 Unicode） | `string` |
| [`isPalindrome(text)`](#ispalindrometext) | 判斷是否為迴文，忽略大小寫、空白與標點 | `boolean` |
| [`capitalizeWords(text)`](#capitalizewordstext) | 將每個單字字首大寫、其餘小寫 | `string` |
| [`formatThousands(value)`](#formatthousandsvalue) | 將數字加上千分位逗號 | `string` |
| [`randomInt(min, max)`](#randomintmin-max) | 產生含頭尾範圍的隨機整數 | `number` |
| [`clamp(value, min, max)`](#clampvalue-min-max) | 將數值限制在指定範圍內 | `number` |

### `reverseString(text)`

反轉字串，使用展開運算子逐字元處理，因此不會破壞 Unicode 字元。

```js
reverseString('hello');  // 'olleh'
reverseString('你好');    // '好你'
reverseString('');       // ''
```

- `text` `{string}`：要反轉的字串
- 回傳 `{string}`：反轉後的字串
- 拋出 `{TypeError}`：當 `text` 不是字串

### `isPalindrome(text)`

判斷是否為迴文。比較前會忽略大小寫、空白、標點符號，並保留英數字與中文字。

```js
isPalindrome('racecar');                          // true
isPalindrome('A man, a plan, a canal: Panama');  // true
isPalindrome('hello');                            // false
isPalindrome('');                                 // true
```

- `text` `{string}`：要檢查的字串
- 回傳 `{boolean}`：是迴文回傳 `true`，否則 `false`
- 拋出 `{TypeError}`：當 `text` 不是字串

### `capitalizeWords(text)`

將每個以空白分隔的單字字首轉為大寫、其餘字母轉為小寫，原始空白與斷行會保留。

```js
capitalizeWords('hello world');       // 'Hello World'
capitalizeWords('hELLO wORLD');       // 'Hello World'
capitalizeWords('  multiple   spaces  '); // '  Multiple   Spaces  '
```

- `text` `{string}`：要轉換的字串
- 回傳 `{string}`：轉換後的字串
- 拋出 `{TypeError}`：當 `text` 不是字串

### `formatThousands(value)`

將數字加上千分位逗號，支援負數與小數。

```js
formatThousands(999);          // '999'
formatThousands(1000);         // '1,000'
formatThousands(1234567);      // '1,234,567'
formatThousands(-9876543.21);  // '-9,876,543.21'
```

- `value` `{number}`：要格式化的有限數值
- 回傳 `{string}`：加上千分位的字串
- 拋出 `{TypeError}`：當 `value` 不是有限數字（例如 `NaN`、`Infinity`、字串）

### `randomInt(min, max)`

產生介於 `min` 與 `max` 之間（含頭尾）的隨機整數。

```js
randomInt(1, 6);    // 1、2、3、4、5 或 6
randomInt(5, 5);    // 5
```

- `min` `{number}`：範圍下限（整數）
- `max` `{number}`：範圍上限（整數）
- 回傳 `{number}`：範圍內的隨機整數
- 拋出 `{TypeError}`：當 `min` 或 `max` 不是整數
- 拋出 `{RangeError}`：當 `min` 大於 `max`

### `clamp(value, min, max)`

將數值限制在指定範圍內：小於下限回傳下限，大於上限回傳上限。

```js
clamp(5, 0, 10);    // 5
clamp(-3, 0, 10);   // 0
clamp(42, 0, 10);   // 10
```

- `value` `{number}`：要限制的有限數值
- `min` `{number}`：範圍下限
- `max` `{number}`：範圍上限
- 回傳 `{number}`：限制後的數值
- 拋出 `{TypeError}`：當參數不是有限數字
- 拋出 `{RangeError}`：當 `min` 大於 `max`

## 錯誤處理

所有函式都會驗證參數型別，錯誤會以標準的 `TypeError` 或 `RangeError` 拋出，方便搭配 `try/catch` 使用：

```js
const { formatThousands, randomInt } = require('digital-conversion');

try {
  formatThousands('1000');
} catch (error) {
  console.error(error.name);    // 'TypeError'
  console.error(error.message); // 'value must be a finite number'
}

try {
  randomInt(10, 1);
} catch (error) {
  console.error(error.name);    // 'RangeError'
  console.error(error.message); // 'min must be less than or equal to max'
}
```

## 開發

```bash
# 安裝專案（本套件無執行期依賴）
npm install

# 執行單元測試（使用 Node.js 內建 test runner）
npm test
```

專案結構：

```
digital-conversion/
├── index.js            # 套件原始碼
├── test/
│   └── index.test.js   # 單元測試
├── README.md
├── LICENSE
└── package.json
```

## 版本規則

本套件遵循 [Semantic Versioning](https://semver.org/)：

- 修正錯誤：`patch`（例如 `1.0.0` → `1.0.1`）
- 向下相容的新功能：`minor`（例如 `1.0.0` → `1.1.0`）
- 不相容的變更：`major`（例如 `1.0.0` → `2.0.0`）

## 授權

[ISC](LICENSE)
