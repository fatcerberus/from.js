/*
 *  Oozaru JavaScript game engine
 *  Copyright (c) 2015-2018, Fat Cerberus
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

type Source<T> = T[] | ArrayLike<T> | Query<T>;

type Aggregator<T, R> = (accumulator: R, value: T) => R;
type Iteratee<T> = (value: T) => void;
type JoinPredicate<T, U> = (lValue: T, rValue: U) => boolean;
type Predicate<T> = (value: T) => boolean;
type Selector<T, R> = (value: T) => R;
type ZipSelector<T, U, R> = (lValue: T, rValue: U) => R;

interface Sequence<T>
{
	readonly current: T;
	forEach?(iteratee: Iteratee<T>): void;
	moveNext(): boolean;
	reset(): void;
}

export default
function from<T>(source: Source<T>)
{
	return new Query(enumerate(source));
}

class Query<T> implements Iterable<T>
{
	readonly [Symbol.toStringTag] = "Query";

	private sequence: Sequence<T>;

	constructor(sequence: Sequence<T>)
	{
		this.sequence = sequence;
	}

	*[Symbol.iterator]()
	{
		this.sequence.reset();
		while (this.sequence.moveNext())
			yield this.sequence.current;
	}

	aggregate<R>(aggregator: Aggregator<T, R>, seedValue: R)
	{
		let accumulator = seedValue;
		forEach(this.sequence, it =>
			accumulator = aggregator(accumulator, it));
		return accumulator;
	}

	join<U, R>(innerSource: Source<U>, predicate: JoinPredicate<T, U>, selector: ZipSelector<T, U, R>)
	{
		return this.selectMany(lValue =>
			from(innerSource)
				.where(it => predicate(lValue, it))
				.select(it => selector(lValue, it))
				.toArray());
	}

	select<R>(selector: Selector<T, R>)
	{
		return new Query(new SelectSeq(this.sequence, selector));
	}

	selectMany<R>(selector: Selector<T, Source<R>>)
	{
		return new Query(new SelectManySeq(this.sequence, selector));
	}

	toArray()
	{
		return this.aggregate((a, it) => (a.push(it), a), [] as T[])
	}

	where(predicate: Predicate<T>)
	{
		return new Query(new WhereSeq(this.sequence, predicate));
	}

	zip<U, R>(zipSource: Source<U>, selector: ZipSelector<T, U, R>)
	{
		return new Query(new ZipSeq(this.sequence, enumerate(zipSource), selector));
	}
}

class ArraySeq<T> implements Sequence<T>
{
	private array: ArrayLike<T>;
	private index: number;
	private length: number;

	constructor(array: ArrayLike<T>) {
		this.array = array;
	}
	get current() {
		return this.array[this.index];
	}
	forEach(iteratee: Iteratee<T>) {
		for (let i = 0, len = this.array.length; i < len; ++i)
			iteratee(this.array[i]);
	}
	moveNext() {
		return ++this.index < this.length;
	}
	reset() {
		this.index = -1;
		this.length = this.array.length;
	}
}

class SelectSeq<T, U> implements Sequence<U>
{
	private selector: Selector<T, U>;
	private sequence: Sequence<T>;
	private value: U;

	constructor(sequence: Sequence<T>, selector: Selector<T, U>) {
		this.sequence = sequence;
		this.selector = selector;
	}
	get current() {
		return this.value;
	}
	forEach(iteratee: Iteratee<U>) {
		forEach(this.sequence, it => iteratee(this.selector(it)));
	}
	moveNext() {
		if (!this.sequence.moveNext())
			return false;
		this.value = this.selector(this.sequence.current);
		return true;
	}
	reset() {
		this.sequence.reset();
	}
}

class SelectManySeq<T, U> implements Sequence<U>
{
	private selector: Selector<T, Source<U>>;
	private sequence: Sequence<T>;
	private subSequence?: Sequence<U>;
	private value: U;

	constructor(sequence: Sequence<T>, selector: Selector<T, Source<U>>) {
		this.sequence = sequence;
		this.selector = selector;
	}
	get current() {
		return this.value;
	}
	forEach(iteratee: Iteratee<U>) {
		forEach(this.sequence, it => {
			const picks = enumerate(this.selector(it));
			forEach(picks, iteratee);
		});
	}
	moveNext() {
		if (this.subSequence === undefined || !this.subSequence.moveNext()) {
			if (!this.sequence.moveNext())
				return false;
			const source = this.selector(this.sequence.current);
			this.subSequence = enumerate(source);
			if (!this.subSequence.moveNext())
				return false;
		}
		this.value = this.subSequence.current;
		return true;
	}
	reset() {
		this.sequence.reset();
	}
}

class WhereSeq<T> implements Sequence<T>
{
	private predicate: Predicate<T>;
	private sequence: Sequence<T>;
	private value: T;

	constructor(sequence: Sequence<T>, predicate: Predicate<T>) {
		this.sequence = sequence;
		this.predicate = predicate;
	}
	get current() {
		return this.value;
	}
	forEach(iteratee: Iteratee<T>) {
		forEach(this.sequence, it => {
			if (this.predicate(it))
				iteratee(it);
		});
	}
	moveNext() {
		while (this.sequence.moveNext()) {
			this.value = this.sequence.current;
			if (this.predicate(this.value))
				return true;
		}
		return false;
	}
	reset() {
		this.sequence.reset();
	}
}

class ZipSeq<T, U, R> implements Sequence<R>
{
	private selector: ZipSelector<T, U, R>;
	private leftSeq: Sequence<T>;
	private rightSeq: Sequence<U>;
	private value: R;

	constructor(leftSeq: Sequence<T>, rightSeq: Sequence<U>, selector: ZipSelector<T, U, R>) {
		this.leftSeq = leftSeq;
		this.rightSeq = rightSeq;
		this.selector = selector;
	}
	get current() {
		return this.value;
	}
	moveNext() {
		if (this.leftSeq.moveNext() && this.rightSeq.moveNext()) {
			this.value = this.selector(this.leftSeq.current, this.rightSeq.current);
			return true;
		}
		return false;
	}
	reset() {
		this.leftSeq.reset();
		this.rightSeq.reset();
	}
}

function enumerate<T>(source: Source<T>)
{
	return source instanceof Query
		? source.sequence
		: new ArraySeq(source);
}

function forEach<T>(sequence: Sequence<T>, iteratee: Iteratee<T>)
{
	if (sequence.forEach !== undefined) {
		sequence.forEach(iteratee);
	}
	else {
		sequence.reset();
		while (sequence.moveNext())
			iteratee(sequence.current);
	}
}
