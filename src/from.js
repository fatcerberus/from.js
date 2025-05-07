/*
 *  from.js - LINQ for JavaScript
 *  Copyright (c) 2019-2025, Fat Cerberus
 *  All rights reserved.
 *
 *  Redistribution and use in source and binary forms, with or without
 *  modification, are permitted provided that the following conditions are met:
 *
 *  * Redistributions of source code must retain the above copyright notice,
 *    this list of conditions and the following disclaimer.
 *
 *  * Redistributions in binary form must reproduce the above copyright notice,
 *    this list of conditions and the following disclaimer in the documentation
 *    and/or other materials provided with the distribution.
 *
 *  * Neither the name of miniSphere nor the names of its contributors may be
 *    used to endorse or promote products derived from this software without
 *    specific prior written permission.
 *
 *  THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS"
 *  AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE
 *  IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE
 *  ARE DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT HOLDER OR CONTRIBUTORS BE
 *  LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR
 *  CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF
 *  SUBSTITUTE GOODS OR SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS
 *  INTERRUPTION) HOWEVER CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN
 *  CONTRACT, STRICT LIABILITY, OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE)
 *  ARISING IN ANY WAY OUT OF THE USE OF THIS SOFTWARE, EVEN IF ADVISED OF THE
 *  POSSIBILITY OF SUCH DAMAGE.
**/

export
function from(...sources)
{
	return sources.length === 1
		? new Query(sourceOf(sources[0]))
		: new Query(new ConcatSource(...sources));
}

class Query
{
	source;

	constructor(source)
	{
		this.source = source;
	}

	[Symbol.iterator]()
	{
		return this.source[Symbol.iterator]();
	}

	aggregate(aggregator, seedValue)
	{
		let accumulator = seedValue;
		for (const value of this.source)
			accumulator = aggregator(accumulator, value);
		return accumulator;
	}

	all(predicate)
	{
		for (const value of this.source) {
			if (!predicate(value))
				return false;
		}
		return true;
	}

	allIn(values)
	{
		const valueSet = new Set(sourceOf(values));
		return this.all(it => valueSet.has(it));
	}

	any(predicate)
	{
		for (const value of this.source) {
			if (predicate(value))
				return true;
		}
		return false;
	}

	anyIn(values)
	{
		const valueSet = new Set(sourceOf(values));
		return this.any(it => valueSet.has(it));
	}

	anyIs(value)
	{
		const predicate = value !== value
			? toCheck => toCheck !== toCheck
			: toCheck => toCheck === value;
		return this.any(predicate);
	}

	apply(values)
	{
		return this.selectMany(fn => from(values).select(fn));
	}

	average()
	{
		let count = 0;
		let sum = 0;
		for (const value of this.source) {
			sum += value;
			++count;
		}
		return sum / count;
	}

	besides(iteratee)
	{
		return this.select(it => (iteratee(it), it));
	}

	concat(...sources)
	{
		return new Query(new ConcatSource(this.source, ...sources));
	}

	count()
	{
		let count = 0;
		for (const value of this.source)
			++count;
		return count;
	}

	countBy(keySelector)
	{
		const counts = new Map();
		for (const value of this.source) {
			const key = keySelector(value);
			let count = counts.get(key);
			if (count === undefined)
				count = 0;
			counts.set(key, count++);
		}
		return counts;
	}

	distinct(keySelector)
	{
		return new Query(new DistinctSource(this.source, keySelector));
	}

	elementAt(position)
	{
		let index = 0;
		for (const value of this.source) {
			if (index++ === position)
				return value;
		}
		return undefined;
	}

	except(...blacklists)
	{
		const exclusions = new Set(from(blacklists).selectMany(it => it));
		return new Query(new WithoutSource(this.source, exclusions));
	}

	fatMap(selector, windowSize = 1)
	{
		return new Query(new FatMapSource(this.source, selector, windowSize));
	}

	first(predicate)
	{
		for (const value of this.source) {
			if (predicate(value))
				return value;
		}
		return undefined;
	}

	forEach(iteratee)
	{
		for (const value of this.source)
			iteratee(value);
	}

	groupBy(keySelector)
	{
		const groups = new Map();
		for (const value of this.source) {
			const key = keySelector(value);
			let list = groups.get(key);
			if (list === undefined)
				groups.set(key, list = []);
			list.push(value);
		}
		return groups;
	}

	groupJoin(joinSource, predicate, selector)
	{
		return this.select(lValue => {
			const rValues = from(joinSource)
				.where(it => predicate(lValue, it));
			return selector(lValue, rValues);
		});
	}

	intercalate(values)
	{
		return this.intersperse(values).selectMany(it => it);
	}

	intersperse(value)
	{
		return new Query(new IntersperseSource(this.source, value));
	}

	invoke(...args)
	{
		return this.select(fn => fn(...args));
	}

	join(joinSource, predicate, selector)
	{
		return this.selectMany(lValue =>
			from(joinSource)
				.where(it => predicate(lValue, it))
				.select(it => selector(lValue, it)));
	}

	last(predicate)
	{
		let result;
		for (const value of this.source) {
			if (predicate(value))
				result = value;
		}
		return result;
	}

	memoize()
	{
		return new Query(new MemoSource(this.source));
	}

	orderBy(keySelector, direction = 'asc')
	{
		return new SortQuery(new OrderBySource(this.source, keySelector, direction === 'desc'));
	}

	plus(...values)
	{
		return new Query(new ConcatSource(this.source, values));
	}

	random(count)
	{
		return this.thru((values) => {
			let samples = [];
			for (let i = 0, len = values.length; i < count; ++i) {
				const index = Math.floor(Math.random() * len);
				samples.push(values[index]);
			}
			return samples;
		});
	}

	reverse()
	{
		return this.thru(values => values.reverse());
	}

	sample(count)
	{
		return this.thru((values) => {
			const nSamples = Math.min(Math.max(count, 0), values.length);
			for (let i = 0, len = values.length; i < nSamples; ++i) {
				const pick = i + Math.floor(Math.random() * (len - i));
				const value = values[pick];
				values[pick] = values[i];
				values[i] = value;
			}
			values.length = nSamples;
			return values;
		});
	}

	select(selector)
	{
		return new Query(new SelectSource(this.source, selector));
	}

	selectMany(selector)
	{
		return new Query(new SelectManySource(this.source, selector));
	}

	shuffle()
	{
		return this.thru((values) => {
			for (let i = 0, len = values.length - 1; i < len; ++i) {
				const pick = i + Math.floor(Math.random() * (len - i));
				const value = values[pick];
				values[pick] = values[i];
				values[i] = value;
			}
			return values;
		});
	}

	single(predicate)
	{
		let count = 0;
		let lastResult = undefined;
		for (const value of this.source) {
			if (predicate(value)) {
				if (++count > 1)
					throw new Error("Query would return more than one result");
				lastResult = value;
			}
		}
		return lastResult;
	}

	skip(count)
	{
		return new Query(new SkipSource(this.source, count));
	}

	skipLast(count)
	{
		return new Query(new SkipLastSource(this.source, count));
	}

	skipWhile(predicate)
	{
		return new Query(new SkipWhileSource(this.source, predicate));
	}

	sum()
	{
		return this.aggregate((acc, value) => acc + value, 0);
	}

	take(count)
	{
		return new Query(new TakeSource(this.source, count));
	}

	takeLast(count)
	{
		// takeLast can't be lazily evaluated because we don't know where to
		// start until we've seen the final element.
		return this.thru((values) => {
			return count > 0 ? values.slice(-count) : [];
		});
	}

	takeWhile(predicate)
	{
		return new Query(new TakeWhileSource(this.source, predicate));
	}

	thru(transformer)
	{
		return new Query(new ThruSource(this.source, transformer));
	}

	toArray()
	{
		return Array.from(this.source);
	}

	where(predicate)
	{
		return new Query(new WhereSource(this.source, predicate));
	}

	without(...values)
	{
		return new Query(new WithoutSource(this.source, new Set(values)));
	}

	zip(zipSource, selector)
	{
		return new Query(new ZipSource(this.source, sourceOf(zipSource), selector));
	}
}

class SortQuery extends Query
{
	constructor(source)
	{
		super(source);
	}

	thenBy(keySelector, direction = 'asc')
	{
		return new SortQuery(new OrderBySource(this.source, keySelector, direction === 'desc', true));
	}
}

class ArrayLikeSource
{
	#array;

	constructor(array)
	{
		this.#array = array;
	}

	*[Symbol.iterator]()
	{
		for (let i = 0, len = this.#array.length; i < len; ++i)
			yield this.#array[i];
	}
}

class ChubSource
{
	#armSize;
	#buffer;
	#leftArm = -1;
	#readPtr = -1;
	#rightArm = 0;
	#stride;
	#writePtr = 0;

	constructor(windowSize)
	{
		this.#stride = windowSize * 2 + 1;
		this.#buffer = new Array(this.#stride);
		this.#armSize = windowSize;
	}

	*[Symbol.iterator]()
	{
		let ptr = ((this.#readPtr + this.#stride) - this.#leftArm) % this.#stride;
		const len = 1 + this.#leftArm + this.#rightArm;
		for (let i = 0; i < len; ++i, ptr = (ptr + 1) % this.#stride)
			yield this.#buffer[ptr];
	}

	get value()
	{
		return this.#buffer[this.#readPtr];
	}

	advance()
	{
		if (++this.#readPtr >= this.#stride)
			this.#readPtr = 0;
		if (++this.#leftArm > this.#armSize)
			this.#leftArm = this.#armSize;
		return this.#rightArm-- > 0;
	}

	push(value)
	{
		this.#buffer[this.#writePtr] = value;
		if (++this.#writePtr >= this.#stride)
			this.#writePtr = 0;
		if (++this.#rightArm > this.#armSize)
			this.advance();
	}
}

class ConcatSource
{
	#sources = [];

	constructor(...sources)
	{
		for (let i = 0, len = sources.length; i < len; ++i)
			this.#sources.push(sourceOf(sources[i]));
	}

	*[Symbol.iterator]()
	{
		for (let i = 0, len = this.#sources.length; i < len; ++i)
			yield* this.#sources[i];
	}
}

class DistinctSource
{
	#keySelector;
	#source;

	constructor(source, keySelector)
	{
		this.#source = source;
		this.#keySelector = keySelector;
	}

	*[Symbol.iterator]()
	{
		const foundKeys = new Set();
		for (const value of this.#source) {
			const key = this.#keySelector(value);
			if (!foundKeys.has(key)) {
				foundKeys.add(key);
				yield value;
			}
		}
	}
}

class FatMapSource
{
	#selector;
	#source;
	#windowSize;

	constructor(source, selector, windowSize)
	{
		this.#source = source;
		this.#selector = selector;
		this.#windowSize = windowSize;
	}

	*[Symbol.iterator]()
	{
		const chub = new ChubSource(this.#windowSize)
		let lag = this.#windowSize + 1;
		for (const value of this.#source) {
			chub.push(value);
			if (--lag <= 0)
				yield this.#selector(chub);
		}
		while (chub.advance())
			yield this.#selector(chub);
	}
}

class IntersperseSource
{
	#source;
	#value;

	constructor(source, value)
	{
		this.#source = source;
		this.#value = value;
	}

	*[Symbol.iterator]()
	{
		let firstElement = true;
		for (const value of this.#source) {
			if (!firstElement)
				yield this.#value;
			yield value;
			firstElement = false;
		}
	}
}

class MemoSource
{
	#source;
	#ranOnce = false;

	constructor(source)
	{
		this.#source = source;
	}

	[Symbol.iterator]()
	{
		if (!this.#ranOnce) {
			this.#source = Array.from(this.#source);
			this.#ranOnce = true;
		}
		return this.#source[Symbol.iterator]();
	}
}

class OrderBySource
{
	#keyMakers;
	#source;

	constructor(source, keySelector, descending, auxiliary = false)
	{
		const keyMaker = { keySelector, descending };
		if (auxiliary && source instanceof OrderBySource) {
			this.#source = source.#source;
			this.#keyMakers = [ ...source.#keyMakers, keyMaker ];
		}
		else {
			this.#source = source;
			this.#keyMakers = [ keyMaker ];
		}
	}

	*[Symbol.iterator]()
	{
		const keyLists = [];
		const results = [];
		let index = 0;
		for (const value of this.#source) {
			const keyList = new Array(this.#keyMakers.length);
			for (let i = 0, len = this.#keyMakers.length; i < len; ++i)
				keyList[i] = this.#keyMakers[i].keySelector(value);
			keyLists.push(keyList);
			results.push({ index: index++, value });
		}
		results.sort((a, b) => {
			const aKeys = keyLists[a.index];
			const bKeys = keyLists[b.index];
			for (let i = 0, len = this.#keyMakers.length; i < len; ++i) {
				const invert = this.#keyMakers[i].descending;
				if (aKeys[i] < bKeys[i])
					return invert ? +1 : -1;
				else if (aKeys[i] > bKeys[i])
					return invert ? -1 : +1;
			}
			return a.index - b.index;
		});
		for (let i = 0, len = results.length; i < len; ++i)
			yield results[i].value;
	}
}

class SelectSource
{
	#selector;
	#source;

	constructor(source, selector)
	{
		this.#source = source;
		this.#selector = selector;
	}

	*[Symbol.iterator]()
	{
		for (const value of this.#source)
			yield this.#selector(value);
	}
}

class SelectManySource
{
	#selector;
	#source;

	constructor(source, selector)
	{
		this.#source = source;
		this.#selector = selector;
	}

	*[Symbol.iterator]()
	{
		for (const value of this.#source)
			yield* sourceOf(this.#selector(value));
	}
}

class SkipSource
{
	#count;
	#source;

	constructor(source, count)
	{
		this.#source = source;
		this.#count = count;
	}

	*[Symbol.iterator]()
	{
		let skipsLeft = this.#count;
		for (const value of this.#source) {
			if (skipsLeft-- <= 0)
				yield value;
		}
	}
}

class SkipLastSource
{
	#count;
	#source;

	constructor(source, count)
	{
		this.#source = source;
		this.#count = count;
	}

	*[Symbol.iterator]()
	{
		const buffer = new Array(this.#count);
		let ptr = 0;
		let skipsLeft = this.#count;
		for (const value of this.#source) {
			if (skipsLeft-- <= 0)
				yield buffer[ptr];
			buffer[ptr] = value;
			ptr = (ptr + 1) % this.#count;
		}
	}
}

class SkipWhileSource
{
	#predicate;
	#source;

	constructor(source, predicate)
	{
		this.#source = source;
		this.#predicate = predicate;
	}

	*[Symbol.iterator]()
	{
		let onTheTake = false;
		for (const value of this.#source) {
			if (!onTheTake && this.#predicate(value))
				onTheTake = true;
			if (onTheTake)
				yield value;
		}
	}
}

class TakeSource
{
	#count;
	#source;

	constructor(source, count)
	{
		this.#source = source;
		this.#count = count;
	}

	*[Symbol.iterator]()
	{
		let takesLeft = this.#count;
		for (const value of this.#source) {
			if (takesLeft-- <= 0)
				break;
			yield value;
		}
	}
}

class TakeWhileSource
{
	#predicate;
	#source;

	constructor(source, predicate)
	{
		this.#source = source;
		this.#predicate = predicate;
	}

	*[Symbol.iterator]()
	{
		for (const value of this.#source) {
			if (!this.#predicate(value))
				break;
			yield value;
		}
	}
}

class ThruSource
{
	#source;
	#transformer;

	constructor(source, transformer)
	{
		this.#source = source;
		this.#transformer = transformer;
	}

	[Symbol.iterator]()
	{
		const oldValues = Array.from(this.#source);
		const newValues = this.#transformer(oldValues);
		return sourceOf(newValues)[Symbol.iterator]();
	}
}

class WhereSource
{
	#predicate;
	#source;

	constructor(source, predicate)
	{
		this.#source = source;
		this.#predicate = predicate;
	}

	*[Symbol.iterator]()
	{
		for (const value of this.#source) {
			if (this.#predicate(value))
				yield value;
		}
	}
}

class WithoutSource
{
	#source;
	#values;

	constructor(source, values)
	{
		this.#source = source;
		this.#values = values;
	}

	*[Symbol.iterator]()
	{
		for (const value of this.#source) {
			if (!this.#values.has(value))
				yield value;
		}
	}
}

class ZipSource
{
	#leftSource;
	#rightSource;
	#selector;

	constructor(leftSource, rightSource, selector)
	{
		this.#leftSource = leftSource;
		this.#rightSource = rightSource;
		this.#selector = selector;
	}

	*[Symbol.iterator]()
	{
		const iter = this.#rightSource[Symbol.iterator]();
		let result;
		for (const value of this.#leftSource) {
			if ((result = iter.next()).done)
				break;
			yield this.#selector(value, result.value);
		}
	}
}

function isIterable(source)
{
	return Symbol.iterator in source;
}

function sourceOf(queryable)
{
	return isIterable(queryable) ? queryable
		: new ArrayLikeSource(queryable);
}
